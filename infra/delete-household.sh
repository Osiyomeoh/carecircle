#!/usr/bin/env bash
# Delete every row for one household. Used to clean up round-trip test data.
#   ./infra/delete-household.sh h_roundtrip_1789460713507
set -euo pipefail
HH="${1:?usage: delete-household.sh <householdId>}"
TABLE="${CARECIRCLE_TABLE:-carecircle}"
REGION="${AWS_REGION:-us-east-1}"

KEYS=$(aws dynamodb query --table-name "$TABLE" --region "$REGION" \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values "{\":pk\":{\"S\":\"HH#$HH\"}}" \
  --projection-expression "pk,sk" --output json | python3 -c "
import json,sys
for i in json.load(sys.stdin)['Items']:
    print(json.dumps({'pk':i['pk'],'sk':i['sk']}))
")

if [ -z "$KEYS" ]; then echo "Nothing found for $HH"; exit 0; fi

COUNT=0
while IFS= read -r key; do
  aws dynamodb delete-item --table-name "$TABLE" --region "$REGION" --key "$key" >/dev/null
  COUNT=$((COUNT+1))
done <<< "$KEYS"
echo "Deleted $COUNT item(s) for $HH"
