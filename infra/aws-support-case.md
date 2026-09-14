# AWS Support case — Bedrock inference quotas are zero

Open at **console.aws.amazon.com/support** → Create case → **Service limit increase**
(or Account and billing, if the limit-increase form refuses a zero quota).

- **Service:** Bedrock
- **Region:** us-east-1
- **Limit type:** Model invocation / on-demand inference

---

## Subject

Bedrock on-demand inference quotas are 0 for all models; Service Quotas cannot request an increase

## Body

Account 287977321648 has an applied quota of **0** for every Amazon Bedrock
on-demand inference quota, across all model providers (Anthropic, Amazon Nova,
Meta Llama), in every region I have tried (us-east-1, us-east-2, us-west-2).

Every `Converse` / `InvokeModel` call fails with:

    ThrottlingException: Too many tokens per day, please wait before trying again.

This message describes an exhausted budget, but nothing has been consumed — the
quota has never been non-zero. Waiting does not help.

Examples of applied vs default values in us-east-1:

| Quota code | Quota | Applied | AWS default |
|---|---|---|---|
| L-F4DDD3EB | Cross-region inference tokens/min, Claude Sonnet 4.5 | 0 | 5,000,000 |
| L-4A6BFAB1 | Cross-region inference requests/min, Claude Sonnet 4.5 | 0 | 10,000 |
| L-58BE175A | Cross-region inference tokens/min, Claude Haiku 4.5 | 0 | 5,000,000 |
| L-CCA5DF70 | Cross-region inference requests/min, Claude Haiku 4.5 | 0 | 10,000 |

I cannot resolve this through Service Quotas. `RequestServiceQuotaIncrease` rejects
any desired value at or below the default:

    IllegalArgumentException: You must provide a quota value greater than the
    default quota value of 5000000.0

So with an applied quota of 0 and a default of 5,000,000, the only requests the API
will accept are for *more than* the default — there is no way to ask simply to be
restored to it.

**What I need:** on-demand inference enabled for this account with any non-zero
quota. A small allocation is sufficient — roughly 200,000 tokens/minute and 200
requests/minute for Claude Sonnet 4.5 and Claude Haiku 4.5 in us-east-1.

**Context:** this is for a project being submitted to the Amazon Developer Hackathon
(Alexa+ / MCP track), which closes 23 October 2026. Model access has been requested
and shows as available in the Bedrock console; the IAM principal has
`bedrock:InvokeModel` and `bedrock:Converse`, and calls return ThrottlingException
rather than AccessDenied, so this is a quota allocation issue rather than permissions
or model access.
