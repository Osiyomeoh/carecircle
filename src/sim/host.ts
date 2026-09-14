import {
  BedrockRuntimeClient, ConverseCommand,
  type ContentBlock, type Message, type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * The simulated Alexa+ host.
 *
 * This is a real MCP host, not a scripted mock: a Bedrock model is given the
 * CareCircle server's tools and decides for itself which to call. That matters for
 * the demo's credibility — what a judge sees is the model reasoning over our tool
 * descriptions, which is exactly what Alexa+ will do.
 *
 * The host is deliberately thin. Everything that decides *what is true* lives in
 * the MCP server; the model only chooses tools and speaks results.
 */

/** How Alexa+ should behave. Kept short: the tool descriptions do the real work. */
const SYSTEM_PROMPT = `You are Alexa, speaking to a member of a family caring for an elderly relative.

Rules:
- Use the CareCircle tools for anything about medications, appointments, notes, or who is responsible for what. Never answer from memory.
- Tool results are already written to be spoken. Say them as written; do not reformat, summarise, or add markdown.
- Never say someone did not take a medication or did not do something. The system only knows what has been recorded, and a missing record is not evidence. Say there is no record.
- When a tool returns an error, follow the instruction inside it — usually asking the person a question.
- Be brief. This is a voice conversation, not a chat window.`;

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
  readonly #bedrock: BedrockRuntimeClient;
  readonly #modelId: string;
  readonly #mcp: Client;
  #tools: Tool[] = [];
  /** Per-member conversation history, so each device keeps its own thread. */
  #history: Message[] = [];

  private constructor(bedrock: BedrockRuntimeClient, modelId: string, mcp: Client) {
    this.#bedrock = bedrock;
    this.#modelId = modelId;
    this.#mcp = mcp;
  }

  /** Connect to the CareCircle server as one member of the care circle. */
  static async connect(opts: {
    endpoint: string; token: string; region: string; modelId: string;
  }): Promise<SimulatedAlexa> {
    const mcp = new Client({ name: 'alexa-plus-simulator', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(opts.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${opts.token}` } },
    });
    await mcp.connect(transport as never);

    const host = new SimulatedAlexa(
      new BedrockRuntimeClient({ region: opts.region }), opts.modelId, mcp,
    );
    await host.#loadTools();
    return host;
  }

  /**
   * Translate MCP tool definitions into Bedrock tool specs.
   *
   * The descriptions pass through untouched: how well the model chooses is a direct
   * test of how well the server's tool descriptions are written.
   */
  async #loadTools(): Promise<void> {
    const { tools } = await this.#mcp.listTools();
    this.#tools = tools.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description ?? '',
        inputSchema: { json: (t.inputSchema ?? { type: 'object', properties: {} }) as never },
      },
    }));
  }

  get toolCount(): number { return this.#tools.length; }

  /** One conversational turn: what the person said in, what Alexa says out. */
  async say(utterance: string): Promise<TurnResult> {
    this.#history.push({ role: 'user', content: [{ text: utterance }] });
    const toolCalls: ToolCallRecord[] = [];

    // Bounded so a confused model cannot loop forever on a live demo.
    for (let step = 0; step < 6; step += 1) {
      const response = await this.#bedrock.send(new ConverseCommand({
        modelId: this.#modelId,
        system: [{ text: SYSTEM_PROMPT }],
        messages: this.#history,
        toolConfig: { tools: this.#tools },
        inferenceConfig: { maxTokens: 512, temperature: 0 },
      }));

      const content = response.output?.message?.content ?? [];
      this.#history.push({ role: 'assistant', content });

      const uses = content.filter((c) => 'toolUse' in c && c.toolUse);
      if (uses.length === 0) {
        const spoken = content.map((c) => ('text' in c ? c.text : '')).join(' ').trim();
        return { spoken, toolCalls };
      }

      const results: ContentBlock[] = [];
      for (const block of uses) {
        const use = block.toolUse!;
        const args = (use.input ?? {}) as Record<string, unknown>;
        const started = Date.now();
        let text = '';
        let structured: unknown;
        let isError = false;
        try {
          const out = await this.#mcp.callTool({
            name: use.name!, arguments: args,
          }) as { content?: { text?: string }[]; structuredContent?: unknown; isError?: boolean };
          text = out.content?.[0]?.text ?? '';
          structured = out.structuredContent;
          isError = out.isError === true;
        } catch (err) {
          text = `The tool failed: ${(err as Error).message}`;
          isError = true;
        }
        toolCalls.push({
          name: use.name!, arguments: args, result: text,
          ...(structured !== undefined ? { structured } : {}),
          isError, ms: Date.now() - started,
        });
        results.push({
          toolResult: {
            toolUseId: use.toolUseId!,
            content: [{ text }],
            status: isError ? 'error' : 'success',
          },
        });
      }
      this.#history.push({ role: 'user', content: results });
    }

    return {
      spoken: "Sorry, I got stuck working that out. Could you say it another way?",
      toolCalls,
    };
  }

  async close(): Promise<void> { await this.#mcp.close(); }
}
