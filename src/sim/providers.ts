import {
  BedrockRuntimeClient, ConverseCommand,
  type ContentBlock, type Message, type Tool as BedrockTool,
} from '@aws-sdk/client-bedrock-runtime';
import { GoogleGenAI, type FunctionDeclaration } from '@google/genai';

/**
 * Model providers.
 *
 * The simulated Alexa+ host needs a model that can choose tools. Which model is an
 * implementation detail: an MCP server that only works with one vendor's planner
 * would be a poor demonstration of an open protocol.
 *
 * Bedrock is the submission path — the AWS integration is part of what CareCircle
 * claims. Gemini exists so tool descriptions can be iterated on when Bedrock is
 * unavailable, and because being able to swap planners is itself evidence that the
 * server is not coupled to one.
 */

/** A tool as the server describes it, before any provider-specific shaping. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TurnOutput {
  /** What the model said, if it spoke rather than called a tool. */
  text: string;
  toolUses: ToolUse[];
}

export interface ToolResult {
  id: string;
  name: string;
  text: string;
  isError: boolean;
}

/**
 * A conversation the provider owns.
 *
 * Providers differ in how they represent history, so each keeps its own rather
 * than forcing a lowest-common-denominator shape through the host.
 */
export interface Conversation {
  say(utterance: string): Promise<TurnOutput>;
  report(results: ToolResult[]): Promise<TurnOutput>;
}

export interface ModelProvider {
  readonly name: string;
  readonly modelId: string;
  start(system: string, tools: ToolSpec[]): Conversation;
}

// --- Bedrock -------------------------------------------------------------

export class BedrockProvider implements ModelProvider {
  readonly name = 'bedrock';
  readonly modelId: string;
  readonly #client: BedrockRuntimeClient;

  constructor(opts: { region: string; modelId: string }) {
    this.modelId = opts.modelId;
    this.#client = new BedrockRuntimeClient({ region: opts.region });
  }

  start(system: string, tools: ToolSpec[]): Conversation {
    const history: Message[] = [];
    const toolConfig: { tools: BedrockTool[] } = {
      tools: tools.map((t) => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.inputSchema as never },
        },
      })),
    };

    const turn = async (): Promise<TurnOutput> => {
      const response = await this.#client.send(new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: system }],
        messages: history,
        toolConfig,
        inferenceConfig: { maxTokens: 512, temperature: 0 },
      }));
      const content = response.output?.message?.content ?? [];
      history.push({ role: 'assistant', content });
      return {
        text: content.map((c) => ('text' in c ? c.text ?? '' : '')).join(' ').trim(),
        toolUses: content
          .filter((c) => 'toolUse' in c && c.toolUse)
          .map((c) => ({
            id: c.toolUse!.toolUseId!,
            name: c.toolUse!.name!,
            input: (c.toolUse!.input ?? {}) as Record<string, unknown>,
          })),
      };
    };

    return {
      async say(utterance) {
        history.push({ role: 'user', content: [{ text: utterance }] });
        return turn();
      },
      async report(results) {
        const blocks: ContentBlock[] = results.map((r) => ({
          toolResult: {
            toolUseId: r.id,
            content: [{ text: r.text }],
            status: r.isError ? 'error' : 'success',
          },
        }));
        history.push({ role: 'user', content: blocks });
        return turn();
      },
    };
  }
}

// --- Gemini --------------------------------------------------------------

/**
 * Gemini rejects JSON Schema keywords it does not know, so schemas are trimmed to
 * the subset it accepts. Dropping a constraint changes what the model is told
 * about valid input, so only descriptive and structural keys are kept.
 */
function geminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const ALLOWED = new Set([
    'type', 'description', 'properties', 'required', 'items', 'enum', 'nullable',
  ]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!ALLOWED.has(key)) continue;
      out[key] = key === 'properties'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v)]),
          )
        : walk(value);
    }
    // Gemini requires a type; objects without one are rejected outright.
    if (!('type' in out) && 'properties' in out) out['type'] = 'object';
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

export class GeminiProvider implements ModelProvider {
  readonly name = 'gemini';
  readonly modelId: string;
  readonly #ai: GoogleGenAI;

  constructor(opts: { modelId: string; apiKey?: string; project?: string; location?: string }) {
    this.modelId = opts.modelId;
    this.#ai = opts.apiKey
      ? new GoogleGenAI({ apiKey: opts.apiKey })
      : new GoogleGenAI({
          vertexai: true,
          project: opts.project ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? '',
          location: opts.location ?? 'us-central1',
        });
  }

  start(system: string, tools: ToolSpec[]): Conversation {
    const declarations: FunctionDeclaration[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: geminiSchema(t.inputSchema) as never,
    }));
    const history: { role: string; parts: Record<string, unknown>[] }[] = [];
    const ai = this.#ai;
    const modelId = this.modelId;

    const turn = async (): Promise<TurnOutput> => {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: history as never,
        config: {
          systemInstruction: system,
          tools: [{ functionDeclarations: declarations }],
          temperature: 0,
          maxOutputTokens: 512,
        },
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      history.push({ role: 'model', parts: parts as never });

      const toolUses: ToolUse[] = [];
      let text = '';
      for (const [index, part] of parts.entries()) {
        if (part.functionCall?.name) {
          toolUses.push({
            // Gemini does not issue call ids; position is stable within a turn.
            id: part.functionCall.id ?? `call_${index}`,
            name: part.functionCall.name,
            input: (part.functionCall.args ?? {}) as Record<string, unknown>,
          });
        } else if (part.text) {
          text += part.text;
        }
      }
      return { text: text.trim(), toolUses };
    };

    return {
      async say(utterance) {
        history.push({ role: 'user', parts: [{ text: utterance }] });
        return turn();
      },
      async report(results) {
        history.push({
          role: 'user',
          parts: results.map((r) => ({
            functionResponse: {
              name: r.name,
              response: r.isError ? { error: r.text } : { result: r.text },
            },
          })),
        });
        return turn();
      },
    };
  }
}

// --- selection -----------------------------------------------------------

/**
 * Build a provider from the environment.
 *
 * Bedrock unless `CARECIRCLE_PROVIDER=gemini`, so the submission path is what runs
 * by default and an alternative planner is always a deliberate choice.
 */
export function providerFromEnv(): ModelProvider {
  if ((process.env['CARECIRCLE_PROVIDER'] ?? 'bedrock').toLowerCase() === 'gemini') {
    const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
    return new GeminiProvider({
      modelId: process.env['GEMINI_MODEL_ID'] ?? 'gemini-3.5-flash',
      ...(apiKey ? { apiKey } : {}),
      ...(process.env['GOOGLE_CLOUD_PROJECT'] ? { project: process.env['GOOGLE_CLOUD_PROJECT'] } : {}),
    });
  }
  return new BedrockProvider({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    modelId: process.env['BEDROCK_MODEL_ID'] ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  });
}
