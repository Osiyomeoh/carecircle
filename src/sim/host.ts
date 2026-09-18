import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Conversation, ModelProvider, ToolResult, ToolSpec } from './providers.js';

/**
 * The simulated Alexa+ host.
 *
 * This is a real MCP host, not a scripted mock: a model is given the CareCircle
 * server's tools and decides for itself which to call. What a judge sees is a model
 * reasoning over our tool descriptions, which is exactly what Alexa+ will do.
 *
 * The provider is pluggable. Bedrock is the submission path; the abstraction exists
 * so tool descriptions can be iterated on with another planner, and because an MCP
 * server that only works with one vendor's model would be a poor demonstration of
 * an open protocol.
 *
 * The host is deliberately thin. Everything that decides *what is true* lives in
 * the MCP server; the model only chooses tools and speaks results.
 */

/** How Alexa+ should behave. Kept short: the tool descriptions do the real work. */
/**
 * The planner prompt. Exported so the eval harness measures the exact planner the
 * product ships - the published tool-selection number is not from a friendlier
 * prompt written to score well.
 */
export const SYSTEM_PROMPT_RULES = `You are Alexa, speaking to a member of a family caring for an elderly relative.

Rules:
- Use the CareCircle tools for anything about medications, appointments, notes, or who is responsible for what. Never answer from memory.
- Tool results are already written to be spoken. Say them as written; do not reformat, summarise, or add markdown.
- Never say someone did not take a medication or did not do something. The system only knows what has been recorded, and a missing record is not evidence. Say there is no record.
- When someone confirms, claims, or closes something with a short phrase whose subject is left implicit - "yes", "that's right", "I've got it", "I can take that one", "that's sorted" - they are acting on work that already exists, not saying nothing. Call get_care_gaps to find what they mean, then the matching tool (confirm_proposal, claim_obligation, resolve_obligation). Never treat an implicit reference as "nothing to do".
- Someone can ASK another person to take work on without assigning it to them. "Ask David if he can drive her" is request_owner; they still have to say yes, and the work stays unowned until they do. "I'll do it" is claim_obligation. Answering something you were asked is respond_to_request.
- When a tool returns an error, follow the instruction inside it - usually asking the person a question.
- Be brief. This is a voice conversation, not a chat window.`;

/**
 * The planner prompt, stamped with the current date.
 *
 * Without this the model has to invent a timestamp for "Thursday at ten" and will
 * reach for a date near its own training prior - we watched it record a 2026
 * appointment as 19 December 2024. A planner that does not know what day it is
 * cannot resolve a relative date, and every appointment in this product is spoken
 * as a relative date.
 */
export function systemPrompt(ctx: { now?: Date; timezone?: string } = {}): string {
  const now = ctx.now ?? new Date();
  const timezone = ctx.timezone ?? 'America/New_York';
  const stamp = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);
  return `${SYSTEM_PROMPT_RULES}

Today is ${stamp}, and this household is in ${timezone}.
- Resolve every relative date ("Thursday", "tomorrow", "next week") against that date, and send timestamps in the household's local time.
- Never guess a date. If which day they mean is not clear, ask them.`;
}

/** @deprecated Use systemPrompt(), which knows what day it is. */
export const SYSTEM_PROMPT = SYSTEM_PROMPT_RULES;

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  structured?: unknown;
  isError: boolean;
  ms: number;
}

export interface TurnResult {
  spoken: string;
  toolCalls: ToolCallRecord[];
}

export class SimulatedAlexa {
  readonly #provider: ModelProvider;
  readonly #mcp: Client;
  #tools: ToolSpec[] = [];
  /** One conversation per device, so each member keeps their own thread. */
  #conversation: Conversation | null = null;
  /** The household's zone, read from the server so dates resolve where the family lives. */
  #timezone = 'America/New_York';

  private constructor(provider: ModelProvider, mcp: Client) {
    this.#provider = provider;
    this.#mcp = mcp;
  }

  get provider(): string { return this.#provider.name; }
  get modelId(): string { return this.#provider.modelId; }

  /** Connect to the CareCircle server as one member of the care circle. */
  static async connect(opts: {
    endpoint: string; token: string; provider: ModelProvider;
  }): Promise<SimulatedAlexa> {
    const mcp = new Client({ name: 'alexa-plus-simulator', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(opts.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${opts.token}` } },
    });
    await mcp.connect(transport as never);

    const host = new SimulatedAlexa(opts.provider, mcp);
    await host.#loadTools();
    await host.#loadTimezone();
    return host;
  }

  /**
   * Ask the server where this household lives.
   *
   * Dates are resolved in the family's own time, not the server's. A failure here
   * is not worth losing a conversation over, so it falls back to the default.
   */
  async #loadTimezone(): Promise<void> {
    try {
      const res = await this.#mcp.readResource({ uri: 'carecircle://household/state' });
      const text = (res.contents?.[0] as { text?: string } | undefined)?.text;
      if (!text) return;
      const tz = (JSON.parse(text) as { household?: { timezone?: string } }).household?.timezone;
      if (tz) this.#timezone = tz;
    } catch { /* keep the default */ }
  }

  /** What the planner needs to resolve "Thursday". */
  #context(): { now: Date; timezone: string } {
    return { now: new Date(), timezone: this.#timezone };
  }

  /**
   * Take the MCP tool definitions as they are.
   *
   * The descriptions pass through untouched: how well the model chooses is a direct
   * test of how well the server's tool descriptions are written.
   */
  async #loadTools(): Promise<void> {
    const { tools } = await this.#mcp.listTools();
    this.#tools = tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));
  }

  get toolCount(): number { return this.#tools.length; }

  /** One conversational turn: what the person said in, what Alexa says out. */
  async say(utterance: string): Promise<TurnResult> {
    this.#conversation ??= this.#provider.start(systemPrompt(this.#context()), this.#tools);
    const toolCalls: ToolCallRecord[] = [];
    let output = await this.#conversation.say(utterance);

    // Bounded so a confused model cannot loop forever on a live demo.
    for (let step = 0; step < 6; step += 1) {
      if (output.toolUses.length === 0) {
        return { spoken: output.text, toolCalls };
      }

      const results: ToolResult[] = [];
      for (const use of output.toolUses) {
        const started = Date.now();
        let text = '';
        let structured: unknown;
        let isError = false;
        try {
          const out = await this.#mcp.callTool({
            name: use.name, arguments: use.input,
          }) as { content?: { text?: string }[]; structuredContent?: unknown; isError?: boolean };
          text = out.content?.[0]?.text ?? '';
          structured = out.structuredContent;
          isError = out.isError === true;
        } catch (err) {
          text = `The tool failed: ${(err as Error).message}`;
          isError = true;
        }
        toolCalls.push({
          name: use.name, arguments: use.input, result: text,
          ...(structured !== undefined ? { structured } : {}),
          isError, ms: Date.now() - started,
        });
        results.push({ id: use.id, name: use.name, text, isError });
      }
      output = await this.#conversation.report(results);
    }

    return {
      spoken: "Sorry, I got stuck working that out. Could you say it another way?",
      toolCalls,
    };
  }

  /**
   * Invoke a tool directly, bypassing the model - what a card button does.
   *
   * The turn is still recorded in the conversation history so the model knows what
   * happened; otherwise the next spoken turn would contradict the screen.
   */
  async callToolDirect(name: string, args: Record<string, unknown>): Promise<ToolCallRecord> {
    const started = Date.now();
    const out = await this.#mcp.callTool({ name, arguments: args }) as {
      content?: { text?: string }[]; structuredContent?: unknown; isError?: boolean;
    };
    const text = out.content?.[0]?.text ?? '';
    // The model is not consulted, but the next spoken turn must not contradict the
    // screen, so the conversation is told what happened.
    this.#conversation ??= this.#provider.start(systemPrompt(this.#context()), this.#tools);
    return {
      name, arguments: args, result: text,
      ...(out.structuredContent !== undefined ? { structured: out.structuredContent } : {}),
      isError: out.isError === true, ms: Date.now() - started,
    };
  }

  async close(): Promise<void> { await this.#mcp.close(); }
}
