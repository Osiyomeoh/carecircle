# Infrastructure

## IAM policy

`iam-policy.json` is the full permission set CareCircle needs. Attach it to the
`conductor-hackathon` user as a **customer-managed policy** (4.2 KB — over the 2 KB
inline limit, under the 6 KB managed limit).

```bash
aws iam create-policy \
  --policy-name CareCircleHackathon \
  --policy-document file://infra/iam-policy.json

aws iam attach-user-policy \
  --user-name conductor-hackathon \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/CareCircleHackathon
```

### What changed from the original policy, and why

| Added | Why |
|---|---|
| `servicequotas:*` (read + `RequestServiceQuotaIncrease`) | We hit a daily Bedrock token cap and could not read what the limit was, or ask for more. This is what made the throttling undiagnosable. |
| `cloudwatch:Get*/List*/PutMetricData` | To see what consumed the Bedrock budget, and to alarm on spend. The deployment has to stay up until judging ends on 20 November, so an unnoticed cost overrun is a real failure mode. |
| `cloudwatch:PutMetricAlarm` | The budget alarm itself. |
| `freetier:GetFreeTierUsage`, `ce:GetCostAndUsage` | To confirm whether the account is on the free plan — the most likely cause of the token cap, and not something credits fix. |
| `bedrock:ListFoundationModels`, `ListInferenceProfiles`, `GetInferenceProfile` | Discovering a valid model id currently requires probing until one returns AccessDenied instead of ValidationException. |
| `bedrock:Converse`, `ConverseStream` | Explicit rather than relying on `InvokeModel` covering them. |
| `sns:*` (scoped), `ses:Send*` | `notify_member` should actually deliver a message rather than only recording one. This is also what makes the AWS integration a genuine multi-service pipeline instead of a single Bedrock call. |
| `cognito-idp:*` (scoped) | AgentCore inbound auth is JWT. Each family member becomes a real identity whose `sub` maps to a member — the production form of the identity model. |
| `iam:` list/delete/tag/policy-version actions | The AgentCore CLI creates, updates and tears down execution roles. `CreateRole` alone is not enough to redeploy or clean up. |
| `xray:Put*` | AgentCore observability. |
| `sts:AssumeRole` | Assuming the execution role locally to reproduce what the deployed runtime sees. |

### Note on scope

Every statement uses `"Resource": "*"`. That is appropriate for a hackathon account
and would not be for production — the statements are split and named so they can be
scoped to specific ARNs later without rewriting the policy.

### This does not fix the throttling

The daily Bedrock token cap is a **quota**, not a permission. Every model family —
Amazon Nova, Meta Llama, Anthropic — returns `ThrottlingException: Too many tokens
per day`, which points at an account-plan limit rather than anything CareCircle
consumed. Credits do not raise a quota; they only pay for usage within it.

What this policy buys is the ability to *see* the limit and *request* an increase,
which is currently impossible.
