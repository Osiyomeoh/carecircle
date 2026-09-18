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
CONFIG="{\"ImageRepository\":{\"ImageIdentifier\":\"$ECR_URI:latest\",\"ImageRepositoryType\":\"ECR\",\"ImageConfiguration\":{\"Port\":\"8000\",\"RuntimeEnvironmentVariables\":{\"CARECIRCLE_TABLE\":\"${CARECIRCLE_TABLE:-carecircle}\",\"AWS_REGION\":\"$REGION\"}}},\"AutoDeploymentsEnabled\":false}"
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
