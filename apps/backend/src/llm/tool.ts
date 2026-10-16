// One structured "tool call" helper over either provider. Both call sites (invoice extraction, planner) only need:
// system prompt + user content + a JSON schema -> a parsed object. The model has no other tools, no keys.
import Anthropic from "@anthropic-ai/sdk";

export type Provider = "anthropic" | "openai";

export interface LlmCreds {
  provider: Provider;
  apiKey: string;
  model: string;
}

export interface ToolRequest {
  system: string;
  /** Plain text for the user turn. */
  text?: string;
  /** Scanned-PDF fallback (base64). */
  pdfBase64?: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

/** Picks the provider from LLM_PROVIDER, else whichever key is present (Anthropic first). Null = AI disabled. */
export function resolveLlm(env: {
  LLM_PROVIDER?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}, model: string | undefined): LlmCreds | null {
  if (!model || model === "none") return null;
  const want = env.LLM_PROVIDER as Provider | undefined;
  if ((want === "openai" || (!want && !env.ANTHROPIC_API_KEY)) && env.OPENAI_API_KEY) {
    return { provider: "openai", apiKey: env.OPENAI_API_KEY, model };
  }
  if ((want === "anthropic" || !want) && env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", apiKey: env.ANTHROPIC_API_KEY, model };
  }
  return null;
}

export async function callTool(c: LlmCreds, r: ToolRequest): Promise<unknown> {
  return c.provider === "openai" ? callOpenAI(c, r) : callAnthropic(c, r);
}

async function callAnthropic(c: LlmCreds, r: ToolRequest): Promise<unknown> {
  const client = new Anthropic({ apiKey: c.apiKey, timeout: r.timeoutMs, maxRetries: 1 });
  const content: Anthropic.MessageParam["content"] = r.pdfBase64
    ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: r.pdfBase64 } }]
    : [{ type: "text", text: r.text ?? "" }];
  const res = await client.messages.create({
    model: c.model,
    max_tokens: r.maxTokens,
    system: r.system,
    tools: [{ name: r.toolName, description: r.toolDescription, input_schema: r.schema as Anthropic.Tool.InputSchema }],
    tool_choice: { type: "tool", name: r.toolName },
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("model returned no tool call");
  return block.input;
}

async function callOpenAI(c: LlmCreds, r: ToolRequest): Promise<unknown> {
  const userContent: unknown = r.pdfBase64
    ? [{ type: "file", file: { filename: "invoice.pdf", file_data: `data:application/pdf;base64,${r.pdfBase64}` } }]
    : r.text ?? "";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${c.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: c.model,
      max_completion_tokens: r.maxTokens,
      messages: [{ role: "system", content: r.system }, { role: "user", content: userContent }],
      tools: [{ type: "function", function: { name: r.toolName, description: r.toolDescription, parameters: r.schema } }],
      tool_choice: { type: "function", function: { name: r.toolName } },
    }),
    signal: AbortSignal.timeout(r.timeoutMs),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
  };
  const args = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("model returned no tool call");
  return JSON.parse(args);
}
