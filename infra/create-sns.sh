#!/usr/bin/env bash
# Create the CareCircle notification topic and (optionally) subscribe an email.
#   ./infra/create-sns.sh you@example.com
set -euo pipefail
NAME="${CARECIRCLE_SNS_NAME:-carecircle-demo}"
REGION="${AWS_REGION:-us-east-1}"
ARN=$(aws sns create-topic --name "$NAME" --region "$REGION" --query TopicArn --output text)
echo "Topic: $ARN"
if [ "${1:-}" != "" ]; then
  aws sns subscribe --topic-arn "$ARN" --protocol email \
    --notification-endpoint "$1" --region "$REGION" >/dev/null
  echo "Subscribed $1 - check inbox and confirm the subscription."
fi
echo "Set: export CARECIRCLE_SNS_TOPIC=$ARN"
