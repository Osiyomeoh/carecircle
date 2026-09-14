import {
  BedrockRuntimeClient, ConverseCommand, type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CORPUS, MEMBER_LABEL, type EvalCase } from './corpus.js';

/**
 * Tool-selection evaluation.
 *
 * The model is given the CareCircle server's real tool definitions — descriptions
 * and schemas exactly as an Alexa+ planner would see them — and one utterance. We
 * record which tool it reaches for first and stop there.
 *
 * Nothing is executed. This measures the quality of the tool *descriptions*, which
 * is the part of an MCP server that decides whether it works in practice, and it
 * keeps cases from polluting each other's state.
 */

const SYSTEM = `You are Alexa, speaking to a member of a family caring for an elderly relative.
Use the CareCircle tools for anything about medications, appointments, notes, or who is
responsible for what. Never answer those from memory. If nothing in the conversation needs
a tool, just reply normally. Be brief.`;

export interface CaseResult {
  case: EvalCase;
  chosen: string | null;
  args: Record<string, unknown>;
  pass: boolean;
  reason: string;
  /**
   * The call never reached the model — credentials, throttling, network.
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

async function toolsFor(endpoint: string, token: string): Promise<Tool[]> {
  const client = new Client({ name: 'carecircle-evals', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }) as never);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => ({
    toolSpec: {
      name: t.name,
      description: t.description ?? '',
      inputSchema: { json: (t.inputSchema ?? { type: 'object', properties: {} }) as never },
    },
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

export async function runEvals(options: {
  endpoint: string; region: string; modelId: string; filter?: string;
}): Promise<CaseResult[]> {
  const bedrock = new BedrockRuntimeClient({ region: options.region });
  const cases = options.filter
    ? CORPUS.filter((c) => c.id.startsWith(options.filter!))
    : CORPUS;

  // Tool definitions are identical for every member; fetch once.
  const tools = await toolsFor(options.endpoint, TOKENS.m_david);
  const results: CaseResult[] = [];

  for (const c of cases) {
    let chosen: string | null = null;
    let args: Record<string, unknown> = {};
    try {
      const response = await bedrock.send(new ConverseCommand({
        modelId: options.modelId,
        system: [{ text: SYSTEM }],
        messages: [{ role: 'user', content: [{ text: c.utterance }] }],
        toolConfig: { tools },
        inferenceConfig: { maxTokens: 512, temperature: 0 },
      }));
      const content = response.output?.message?.content ?? [];
      const use = content.find((b) => 'toolUse' in b && b.toolUse)?.toolUse;
      if (use) {
        chosen = use.name ?? null;
        args = (use.input ?? {}) as Record<string, unknown>;
      }
    } catch (err) {
      results.push({
        case: c, chosen: null, args: {}, pass: false, errored: true,
        reason: `bedrock error: ${(err as Error).message}`,
      });
      continue;
    }
    const { pass, reason } = judge(c, chosen, args);
    results.push({ case: c, chosen, args, pass, reason });
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
    // Null, not zero, when nothing was scored — an unreported number beats a false one.
    accuracy: scored.length === 0 ? null : passed / scored.length,
    errored: errors.length,
    byCategory: [...byCategory].map(([category, v]) => ({ category, ...v })),
    failures: scored.filter((r) => !r.pass),
    errors,
  };
}

export { MEMBER_LABEL };
