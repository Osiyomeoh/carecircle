import {
  ServiceQuotasClient, ListServiceQuotasCommand, GetServiceQuotaCommand,
} from '@aws-sdk/client-service-quotas';

/**
 * Bedrock preflight.
 *
 * Bedrock reports a zero quota and an exhausted quota with the same error -
 * `ThrottlingException: Too many tokens per day` - but they are opposite
 * situations. An exhausted budget refills; a zero quota never will, because there
 * is nothing to replenish. Clients retry ThrottlingException by default, so a
 * zeroed account retries forever.
 *
 * This check reads the applied quota values and says which one you are in. It cost
 * us most of a day to work out by hand; it should cost the next person one second.
 *
 * See docs/FRICTION-LOG.md for the full account of the failure mode.
 */

export type Diagnosis =
  /** Quotas are non-zero. Any throttling is genuine rate limiting. */
  | { state: 'ok'; checked: number }
  /**
   * An account-level override has set the quota to zero. Only AWS Support can
   * lift this - Service Quotas refuses requests at or below the default.
   */
  | { state: 'account_hold'; quotas: QuotaFact[]; advice: string }
  /** Quota is zero but not an account override - likely never provisioned. */
  | { state: 'zero_quota'; quotas: QuotaFact[]; advice: string }
  /** We could not look. Not a verdict - the caller should proceed and rely on runtime errors. */
  | { state: 'unknown'; reason: string };

export interface QuotaFact {
  code: string;
  name: string;
  applied: number;
  appliedAtLevel?: string;
  adjustable: boolean;
}

/**
 * Classify quota facts. Pure, so the interesting logic is testable without AWS -
 * which matters because the situation it detects is hard to reproduce on demand.
 */
export function classify(quotas: QuotaFact[]): Diagnosis {
  if (quotas.length === 0) {
    return { state: 'unknown', reason: 'No matching Bedrock inference quotas were found.' };
  }
  const zeroed = quotas.filter((q) => q.applied === 0);
  if (zeroed.length === 0) return { state: 'ok', checked: quotas.length };

  const accountLevel = zeroed.filter((q) => q.appliedAtLevel === 'ACCOUNT');
  if (accountLevel.length > 0) {
    return {
      state: 'account_hold',
      quotas: accountLevel,
      advice:
        'This account has an ACCOUNT-level applied override of 0 on Bedrock inference '
        + 'quotas. Nothing has been consumed and retrying will never succeed. Service '
        + 'Quotas cannot fix it: RequestServiceQuotaIncrease only accepts values above '
        + 'the default, so a zero override cannot be raised back to it. Open an AWS '
        + 'Support case for Amazon Bedrock asking for the account-level hold to be '
        + 'reviewed and lifted. See infra/aws-support-case.md for a drafted case.',
    };
  }
  return {
    state: 'zero_quota',
    quotas: zeroed,
    advice:
      'Bedrock inference quotas are 0 for this account, so no inference is possible. '
      + 'Retrying will not help. Check that model access is granted, then contact AWS '
      + 'Support if the quotas remain at zero.',
  };
}

/** Which quotas matter, derived from the model id in use. */
function relevantTo(modelId: string): (name: string) => boolean {
  // "us.anthropic.claude-sonnet-4-5-20250929-v1:0" -> "claude sonnet 4 5"
  const slug = (modelId.split('.').at(-1) ?? modelId)
    .replace(/-v\d+:\d+$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-/g, ' ')
    .toLowerCase();
  const words = slug.split(' ').filter((w) => w.length > 1);
  return (name: string) => {
    const lower = name.toLowerCase();
    if (!lower.includes('inference') || !lower.includes('per minute')) return false;
    return words.every((w) => lower.includes(w));
  };
}

export interface PreflightOptions {
  region: string;
  modelId: string;
  client?: ServiceQuotasClient;
  /**
   * Specific quota codes to check. Strongly preferred: Bedrock exposes well over a
   * thousand quotas, and paginating all of them takes long enough that the check
   * stops being a preflight. Falls back to a scan when not given.
   */
  quotaCodes?: string[];
}

/**
 * Quota codes for the models CareCircle uses, so the common case is a handful of
 * direct lookups rather than a full enumeration.
 */
export const KNOWN_QUOTA_CODES: Record<string, string[]> = {
  'claude-sonnet-4-5': ['L-F4DDD3EB', 'L-4A6BFAB1'],
  'claude-haiku-4-5': ['L-58BE175A', 'L-CCA5DF70'],
};

/** Quota codes for a model id, when we know them. */
export function codesFor(modelId: string): string[] | undefined {
  for (const [slug, codes] of Object.entries(KNOWN_QUOTA_CODES)) {
    if (modelId.includes(slug)) return codes;
  }
  return undefined;
}

/**
 * Look up the applied quotas for the model in use and classify them.
 *
 * Never throws: an inability to check is reported as `unknown` rather than
 * failing the caller. A diagnostic that takes the service down when it cannot run
 * is worse than no diagnostic.
 */
export async function diagnoseBedrock(options: PreflightOptions): Promise<Diagnosis> {
  const client = options.client ?? new ServiceQuotasClient({ region: options.region });
  const facts: QuotaFact[] = [];
  const codes = options.quotaCodes ?? codesFor(options.modelId);

  try {
    if (codes && codes.length > 0) {
      // Fast path: direct lookups, one call per quota.
      for (const code of codes) {
        const { Quota: q } = await client.send(new GetServiceQuotaCommand({
          ServiceCode: 'bedrock', QuotaCode: code,
        }));
        if (!q?.QuotaName || !q.QuotaCode || q.Value === undefined) continue;
        facts.push({
          code: q.QuotaCode,
          name: q.QuotaName,
          applied: q.Value,
          ...(q.QuotaAppliedAtLevel ? { appliedAtLevel: q.QuotaAppliedAtLevel } : {}),
          adjustable: q.Adjustable === true,
        });
      }
    } else {
      // Fallback: enumerate. Bedrock has >1000 quotas, so use the largest page
      // size available - at the default this takes over a hundred round trips.
      const matches = relevantTo(options.modelId);
      let token: string | undefined;
      do {
        const page = await client.send(new ListServiceQuotasCommand({
          ServiceCode: 'bedrock',
          MaxResults: 100,
          ...(token ? { NextToken: token } : {}),
        }));
        for (const q of page.Quotas ?? []) {
          if (!q.QuotaName || !q.QuotaCode || q.Value === undefined) continue;
          if (!matches(q.QuotaName)) continue;
          facts.push({
            code: q.QuotaCode,
            name: q.QuotaName,
            applied: q.Value,
            ...(q.QuotaAppliedAtLevel ? { appliedAtLevel: q.QuotaAppliedAtLevel } : {}),
            adjustable: q.Adjustable === true,
          });
        }
        token = page.NextToken;
      } while (token);
    }
  } catch (err) {
    const message = (err as Error).message;
    return {
      state: 'unknown',
      reason: /not authorized|AccessDenied/i.test(message)
        ? 'This principal cannot read Service Quotas (servicequotas:ListServiceQuotas), '
          + 'so the Bedrock quota state could not be checked.'
        : `Could not read Service Quotas: ${message}`,
    };
  }

  return classify(facts);
}

/** One-line summary plus the advice, ready to log or return in an error body. */
export function describe(d: Diagnosis): string {
  switch (d.state) {
    case 'ok':
      return `Bedrock quotas look healthy (${d.checked} checked).`;
    case 'account_hold':
      return `BEDROCK ACCOUNT HOLD - ${d.quotas.length} quota(s) applied at 0 at ACCOUNT level: `
        + `${d.quotas.map((q) => q.code).join(', ')}.\n${d.advice}`;
    case 'zero_quota':
      return `BEDROCK QUOTA IS ZERO - ${d.quotas.map((q) => q.code).join(', ')}.\n${d.advice}`;
    case 'unknown':
      return `Bedrock quota state unknown: ${d.reason}`;
  }
}
