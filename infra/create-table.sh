#!/usr/bin/env bash
# Create the CareCircle DynamoDB table. Idempotent.
set -euo pipefail
TABLE="${CARECIRCLE_TABLE:-carecircle}"
REGION="${AWS_REGION:-us-east-1}"

if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "Table $TABLE already exists in $REGION"
  exit 0
fi

aws dynamodb create-table \
  --table-name "$TABLE" \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION" \
  --tags Key=project,Value=carecircle >/dev/null

aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
echo "Created $TABLE in $REGION (on-demand billing)"
