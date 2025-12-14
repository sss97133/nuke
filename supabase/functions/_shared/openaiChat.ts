import type { OpenAiUsage } from "./openaiCost.ts";
import { estimateOpenAiCostUsd } from "./openaiCost.ts";

export type OpenAiChatResult = {
  ok: boolean;
  status: number;
  model: string;
  duration_ms: number;
  usage: OpenAiUsage | null;
  cost_usd: number | null;
  content_text: string | null;
  raw: any;
};

export async function callOpenAiChatCompletions(params: {
  apiKey: string;
  body: any;
  timeoutMs?: number;
}): Promise<OpenAiChatResult> {
  const started = Date.now();
  const timeoutMs = Math.max(1000, params.timeoutMs ?? 20000);
  const model = String(params?.body?.model || "");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });

    const duration_ms = Date.now() - started;
    const raw = await resp.json().catch(async () => ({ raw_text: await resp.text().catch(() => null) }));
    const usage: OpenAiUsage | null = raw?.usage
      ? {
          prompt_tokens: raw.usage.prompt_tokens,
          completion_tokens: raw.usage.completion_tokens,
          total_tokens: raw.usage.total_tokens,
        }
      : null;

    const content_text = raw?.choices?.[0]?.message?.content ?? null;
    const cost_usd = estimateOpenAiCostUsd(model, usage);

    return {
      ok: resp.ok && !raw?.error,
      status: resp.status,
      model,
      duration_ms,
      usage,
      cost_usd,
      content_text: typeof content_text === "string" ? content_text : null,
      raw,
    };
  } finally {
    clearTimeout(t);
  }
}


