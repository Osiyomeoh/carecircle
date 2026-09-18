#!/usr/bin/env bash
# Build the CareCircle MCP server image in the cloud (CodeBuild - no local Docker),
# push to ECR, and serve it on App Runner with a public HTTPS URL. Idempotent.
#
#   AWS_REGION=us-east-1 ./infra/deploy-mcp.sh
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO="carecircle-mcp"
ECR_URI="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO"
BUCKET="carecircle-build-$ACCOUNT-$REGION"

echo "==> ECR repository"
aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$REPO" --region "$REGION" >/dev/null

echo "==> Source bundle -> S3"
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null \
  || aws s3 mb "s3://$BUCKET" --region "$REGION" >/dev/null
git archive --format=zip -o /tmp/carecircle-src.zip HEAD
printf 'version: 0.2\nphases:\n  pre_build:\n    commands:\n      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin %s\n  build:\n    commands:\n      - docker build -t %s:latest .\n  post_build:\n    commands:\n      - docker push %s:latest\n' "$ECR_URI" "$ECR_URI" "$ECR_URI" > /tmp/buildspec.yml
(cd /tmp && zip -q carecircle-src.zip buildspec.yml)
aws s3 cp /tmp/carecircle-src.zip "s3://$BUCKET/src.zip" --region "$REGION" >/dev/null

echo "==> CodeBuild service role"
CB_ROLE="carecircle-codebuild"
if ! aws iam get-role --role-name "$CB_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$CB_ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17","Statement":[{"Effect":"Allow",
    "Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam put-role-policy --role-name "$CB_ROLE" --policy-name inline --policy-document '{
    "Version":"2012-10-17","Statement":[
      {"Effect":"Allow","Action":["logs:*"],"Resource":"*"},
      {"Effect":"Allow","Action":["s3:GetObject","s3:GetObjectVersion"],"Resource":"*"},
      {"Effect":"Allow","Action":["ecr:GetAuthorizationToken","ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:PutImage","ecr:BatchGetImage"],"Resource":"*"}]}' >/dev/null
  sleep 10  # let the role propagate
fi
CB_ROLE_ARN=$(aws iam get-role --role-name "$CB_ROLE" --query Role.Arn --output text)

echo "==> CodeBuild project"
PROJECT="carecircle-build"
SRC="{\"type\":\"S3\",\"location\":\"$BUCKET/src.zip\"}"
ENV="{\"type\":\"LINUX_CONTAINER\",\"image\":\"aws/codebuild/standard:7.0\",\"computeType\":\"BUILD_GENERAL1_SMALL\",\"privilegedMode\":true,\"environmentVariables\":[{\"name\":\"ECR_URI\",\"value\":\"$ECR_URI\"}]}"
if aws codebuild batch-get-projects --names "$PROJECT" --region "$REGION" --query 'projects[0].name' --output text 2>/dev/null | grep -q "$PROJECT"; then
  aws codebuild update-project --name "$PROJECT" --source "$SRC" --environment "$ENV" --service-role "$CB_ROLE_ARN" --region "$REGION" >/dev/null
else
  aws codebuild create-project --name "$PROJECT" --source "$SRC" \
    --artifacts '{"type":"NO_ARTIFACTS"}' --environment "$ENV" \
    --service-role "$CB_ROLE_ARN" --region "$REGION" >/dev/null
fi

export REGION ECR_URI
echo "==> Building image (this takes a few minutes)"
BUILD_ID=$(aws codebuild start-build --project-name "$PROJECT" --region "$REGION" --query 'build.id' --output text)
echo "    build: $BUILD_ID"
while true; do
  STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$REGION" --query 'builds[0].buildStatus' --output text)
  [ "$STATUS" = "IN_PROGRESS" ] || break
  sleep 15
done
echo "    build status: $STATUS"
[ "$STATUS" = "SUCCEEDED" ] || { echo "Build failed - see CodeBuild logs for $BUILD_ID"; exit 1; }

echo "==> App Runner access role (ECR pull)"
AR_ROLE="carecircle-apprunner-access"
if ! aws iam get-role --role-name "$AR_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$AR_ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17","Statement":[{"Effect":"Allow",
    "Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$AR_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess >/dev/null
  sleep 10
fi
AR_ROLE_ARN=$(aws iam get-role --role-name "$AR_ROLE" --query Role.Arn --output text)

echo "==> App Runner instance role (the container's own AWS identity)"
INST_ROLE="carecircle-apprunner-instance"
if ! aws iam get-role --role-name "$INST_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$INST_ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17","Statement":[{"Effect":"Allow",
    "Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  sleep 10
fi
# Written every deploy, not only on creation: the policy grows as the server
# learns to do more, and a role created before Transcribe existed would
# otherwise keep its original permissions forever.
#
# Bedrock is granted on "*" deliberately. A cross-region inference profile
# (us.anthropic.*) authorises against BOTH the profile ARN and the underlying
# foundation model in every region it can route to, so naming one ARN here is a
# reliable way to be denied in production and nowhere else.
aws iam put-role-policy --role-name "$INST_ROLE" --policy-name inline --policy-document '{
  "Version":"2012-10-17","Statement":[
    {"Effect":"Allow","Action":["dynamodb:*"],"Resource":"*"},
    {"Effect":"Allow","Action":["sns:Publish"],"Resource":"*"},
    {"Effect":"Allow","Action":[
      "transcribe:StartStreamTranscription",
      "transcribe:GetVocabulary",
      "transcribe:CreateVocabulary",
      "transcribe:UpdateVocabulary"],"Resource":"*"},
    {"Effect":"Allow","Action":[
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream"],"Resource":"*"},
    {"Effect":"Allow","Action":["polly:SynthesizeSpeech"],"Resource":"*"}]}' >/dev/null
INST_ROLE_ARN=$(aws iam get-role --role-name "$INST_ROLE" --query Role.Arn --output text)

echo "==> App Runner service"
# Runtime configuration, including secrets.
#
# Secrets are read from the DEPLOYING SHELL's environment (source .env first) and
# never appear in this file. They are passed as App Runner runtime variables, which
# means they are readable by anyone with AWS console access to this account.
#
# Secrets Manager (RuntimeEnvironmentSecrets) would be the better home for these and
# the code needs no change to use it - the blocker is that the deploying IAM user has
# no secretsmanager permissions. If that is granted, move CARECIRCLE_OAUTH_SECRET and
# RING_HMAC_KEY to secret ARNs here. For a demo household this is an acceptable
# trade-off; for real medical data it is not.
#
# update-service REPLACES the whole environment map rather than merging into it, so a
# deploy run from a shell that never sourced .env silently DELETES the OAuth and Ring
# secrets from a running service. The deploy reports success, the image is fine, and
# account linking simply stops working. That happened on 2026-09-18. So: read what the
# service already has and treat it as the floor, with the deploying shell overriding.
EXISTING_ARN=$(aws apprunner list-services --region "$REGION" \
  --query "ServiceSummaryList[?ServiceName=='carecircle-mcp'].ServiceArn" --output text)
EXISTING_ENV='{}'
if [ -n "$EXISTING_ARN" ] && [ "$EXISTING_ARN" != "None" ]; then
  EXISTING_ENV=$(aws apprunner describe-service --service-arn "$EXISTING_ARN" --region "$REGION" \
    --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables' \
    --output json)
fi
export EXISTING_ENV

CONFIG=$(python3 - <<PYEOF
import json, os
# Start from what is already deployed, so an unset variable is a variable left alone.
env = json.loads(os.environ.get("EXISTING_ENV") or "{}") or {}
env.update({
    "CARECIRCLE_TABLE": os.environ.get("CARECIRCLE_TABLE", "carecircle"),
    "AWS_REGION": os.environ["REGION"],
    # The agent's heartbeat. Every 15 minutes it lets the policy look at every
    # household and ask, once, about slipping work. The policy owns all restraint
    # (quiet hours, fatigue); this only sets how often it gets the chance.
    "CARECIRCLE_AGENT_INTERVAL_MS": os.environ.get("CARECIRCLE_AGENT_INTERVAL_MS", "900000"),
})
for key in ("CARECIRCLE_OAUTH_SECRET", "CARECIRCLE_PUBLIC_URL", "CARECIRCLE_OAUTH_REDIRECTS", "RING_HMAC_KEY", "RING_HOUSEHOLD_ID"):
    value = os.environ.get(key)
    if value:
        env[key] = value
print(json.dumps({
    "ImageRepository": {
        "ImageIdentifier": os.environ["ECR_URI"] + ":latest",
        "ImageRepositoryType": "ECR",
        "ImageConfiguration": {"Port": "8000", "RuntimeEnvironmentVariables": env},
    },
    "AutoDeploymentsEnabled": False,
}))
PYEOF
)
# Say where each optional setting came from, WITHOUT printing any of their values.
for k in CARECIRCLE_OAUTH_SECRET RING_HMAC_KEY; do
  eval "v=\${$k:-}"
  if [ -n "$v" ]; then
    echo "    $k: set from this shell"
  elif echo "$CONFIG" | grep -q "\"$k\""; then
    echo "    $k: kept from the running service (not in this shell - did you source .env?)"
  else
    echo "    $k: not set (feature stays off)"
  fi
done
ARN=$(aws apprunner list-services --region "$REGION" --query "ServiceSummaryList[?ServiceName=='carecircle-mcp'].ServiceArn" --output text)
if [ -n "$ARN" ]; then
  aws apprunner update-service --service-arn "$ARN" --source-configuration "{\"AuthenticationConfiguration\":{\"AccessRoleArn\":\"$AR_ROLE_ARN\"},$(echo "$CONFIG" | sed 's/^{//')" --region "$REGION" >/dev/null
else
  ARN=$(aws apprunner create-service --service-name carecircle-mcp \
    --source-configuration "{\"AuthenticationConfiguration\":{\"AccessRoleArn\":\"$AR_ROLE_ARN\"},$(echo "$CONFIG" | sed 's/^{//')" \
    --instance-configuration "{\"Cpu\":\"256\",\"Memory\":\"512\",\"InstanceRoleArn\":\"$INST_ROLE_ARN\"}" \
    --health-check-configuration '{"Protocol":"HTTP","Path":"/health","Interval":10,"Timeout":5,"HealthyThreshold":1,"UnhealthyThreshold":5}' \
    --region "$REGION" --query 'Service.ServiceArn' --output text)
fi
URL=$(aws apprunner describe-service --service-arn "$ARN" --region "$REGION" --query 'Service.ServiceUrl' --output text)
echo ""
echo "MCP server: https://$URL/mcp   (health: https://$URL/health)"
echo "It may take a few minutes to reach RUNNING."
