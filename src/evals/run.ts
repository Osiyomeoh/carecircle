import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CORPUS, MEMBER_LABEL, type EvalCase } from './corpus.js';
import type { ModelProvider, ToolSpec } from '../sim/providers.js';
import { systemPrompt } from '../sim/host.js';

/**
 * Tool-selection evaluation.
 *
 * The model is given the CareCircle server's real tool definitions - descriptions
 * and schemas exactly as an Alexa+ planner would see them - and one utterance. We
 * record which tool it reaches for first and stop there.
 *
 * The provider is pluggable, but the figure published in the README must come from
 * Bedrock, since that is the planner the submission claims. Other planners are for
 * finding weak tool descriptions, which is largely model-independent: a description
 * ambiguous enough to confuse one model will usually confuse another.
 *
 * Nothing is executed. This measures the quality of the tool *descriptions*, which
 * is the part of an MCP server that decides whether it works in practice, and it
 * keeps cases from polluting each other's state.
 */

// Measure the exact planner the product ships, not a prompt tuned to score well.
// The eval measures the planner the product actually ships, date stamp included -
// resolving "Thursday" is part of the job being scored.
const SYSTEM = systemPrompt();

export interface CaseResult {
  case: EvalCase;
  chosen: string | null;
  args: Record<string, unknown>;
  pass: boolean;
  reason: string;
  /**
   * The call never reached the model - credentials, throttling, network.
   * Errored cases are excluded from accuracy entirely: counting them as wrong
   * tool choices would report "0% accuracy" when the truth is "nothing ran",
   * and a number that can lie is worse than no number.
   */
  errored?: boolean;
}

const TOKENS: Record<EvalCase['member'], string> = {
  m_margaret: 'margaret-token',
  m_david: 'david-token',
  m_renee: 'renee-token',
  m_aide: 'aide-token',
};

async function toolsFor(endpoint: string, token: string): Promise<ToolSpec[]> {
  const client = new Client({ name: 'carecircle-evals', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }) as never);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
  }));
}

function judge(c: EvalCase, chosen: string | null, args: Record<string, unknown>): {
  pass: boolean; reason: string;
} {
  if (c.expectNone) {
    return chosen === null
      ? { pass: true, reason: 'no tool, as intended' }
      : { pass: false, reason: `called ${chosen} when it should have just answered` };
  }
  if (chosen === null) {
    return { pass: false, reason: `called nothing; expected ${c.expect?.join(' or ')}` };
  }
  if (!c.expect?.includes(chosen)) {
    return { pass: false, reason: `chose ${chosen}; expected ${c.expect?.join(' or ')}` };
  }
  for (const [key, check] of Object.entries(c.args ?? {})) {
    if (!check(args[key])) {
      return { pass: false, reason: `${chosen} called, but argument "${key}" was ${JSON.stringify(args[key])}` };
    }
  }
  return { pass: true, reason: chosen };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rate limiting is transient; a hard failure is not. Only the first is worth retrying. */
function isRateLimit(err: unknown): boolean {
  const message = (err as Error).message ?? '';
  return /\b429\b|rate.?limit|too many requests|RESOURCE_EXHAUSTED|exceeded your current quota|throttl/i
    .test(message);
}

export async function runEvals(options: {
  endpoint: string;
  provider: ModelProvider;
  filter?: string;
  /** Pause between cases, to stay under a provider's requests-per-minute limit. */
  paceMs?: number;
  /** Retries for rate-limited cases. */
  maxRetries?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<CaseResult[]> {
  const cases = options.filter
    ? CORPUS.filter((c) => c.id.startsWith(options.filter!))
    : CORPUS;

  // Tool definitions are identical for every member; fetch once.
  const tools = await toolsFor(options.endpoint, TOKENS.m_david);
  const results: CaseResult[] = [];
  const pace = options.paceMs ?? 0;
  const maxRetries = options.maxRetries ?? 5;

  for (const [index, c] of cases.entries()) {
    if (index > 0 && pace > 0) await sleep(pace);

    let chosen: string | null = null;
    let args: Record<string, unknown> = {};
    let failure: string | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        // A fresh conversation per case: nothing carries over between utterances.
        const output = await options.provider.start(SYSTEM, tools).say(c.utterance);
        const use = output.toolUses[0];
        chosen = use?.name ?? null;
        args = use?.input ?? {};
        failure = null;
        break;
      } catch (err) {
        failure = `${options.provider.name} error: ${(err as Error).message}`;
        if (!isRateLimit(err) || attempt === maxRetries) break;
        // Back off well past a per-minute window; these limits are usually RPM.
        await sleep(Math.min(60_000, 2_000 * 2 ** attempt));
      }
    }

    if (failure !== null) {
      results.push({ case: c, chosen: null, args: {}, pass: false, errored: true, reason: failure });
    } else {
      const { pass, reason } = judge(c, chosen, args);
      results.push({ case: c, chosen, args, pass, reason });
    }
    options.onProgress?.(index + 1, cases.length);
  }
  return results;
}

/** Accuracy per category, so a weak area is visible rather than averaged away. */
export function summarise(results: CaseResult[]): {
  total: number; passed: number; accuracy: number | null; errored: number;
  byCategory: { category: string; passed: number; total: number }[];
  failures: CaseResult[]; errors: CaseResult[];
} {
  const errors = results.filter((r) => r.errored);
  const scored = results.filter((r) => !r.errored);

  const byCategory = new Map<string, { passed: number; total: number }>();
  for (const r of scored) {
    const category = r.case.id.split('-')[0]!;
    const entry = byCategory.get(category) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (r.pass) entry.passed += 1;
    byCategory.set(category, entry);
  }
  const passed = scored.filter((r) => r.pass).length;
  return {
    total: scored.length,
    passed,
    // Null, not zero, when nothing was scored - an unreported number beats a false one.
    accuracy: scored.length === 0 ? null : passed / scored.length,
    errored: errors.length,
    byCategory: [...byCategory].map(([category, v]) => ({ category, ...v })),
    failures: scored.filter((r) => !r.pass),
    errors,
  };
}

export { MEMBER_LABEL };
