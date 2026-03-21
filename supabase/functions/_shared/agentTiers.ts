/**
 * Agent Tier System — BACKWARD COMPATIBILITY SHIM
 *
 * All logic has moved to llmRouter.ts. This file re-exports everything
 * so existing imports (23+ files) continue working without changes.
 *
 * The only function that lives here is callTierVision, which is
 * Anthropic-specific (image fetching + base64 encoding).
 *
 * To add new imports, use llmRouter.ts directly.
 */

// Re-export everything from the unified router
export {
  callTier,
  parseJsonResponse,
  classifyTaskTier,
  estimateBatchCost,
  QUALITY_THRESHOLDS,
  TIER_CONFIGS,
  type AgentTier,
  type AgentCallResult,
} from "./llmRouter.ts";

// Also re-export the new types for callers that want them
export {
  routeAndCall,
  callModel,
  selectModel,
  MODEL_REGISTRY,
  type LLMCallResult,
  type TaskRequirements,
  type LLMProvider,
} from "./llmRouter.ts";

// ── callTierVision stays here (Anthropic-specific) ──────────

import { type AgentTier, type AgentCallResult, TIER_CONFIGS as _TIERS } from "./llmRouter.ts";

// Need the original TIER_CONFIGS format for vision (has model, timeoutMs, cost)
const VISION_TIER_CONFIGS: Record<string, { model: string; maxTokens: number; timeoutMs: number; costPerInputMTok: number; costPerOutputMTok: number }> = {
  haiku: { model: "claude-haiku-4-5-20251001", maxTokens: 4096, timeoutMs: 30_000, costPerInputMTok: 1.00, costPerOutputMTok: 5.00 },
  sonnet: { model: "claude-sonnet-4-6", maxTokens: 8192, timeoutMs: 60_000, costPerInputMTok: 3.00, costPerOutputMTok: 15.00 },
  opus: { model: "claude-opus-4-6", maxTokens: 16384, timeoutMs: 120_000, costPerInputMTok: 5.00, costPerOutputMTok: 25.00 },
};

/**
 * Call the Anthropic API at a given tier with image content (vision).
 * Supports sending one or more images alongside text.
 */
export async function callTierVision(
  tier: AgentTier,
  systemPrompt: string,
  textMessage: string,
  imageUrls: string[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
    imageDetail?: "auto" | "low" | "high";
  },
): Promise<AgentCallResult> {
  const config = VISION_TIER_CONFIGS[tier];
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const maxTokens = options?.maxTokens ?? config.maxTokens;
  const temperature = options?.temperature ?? 0.1;

  // Build content array with images + text
  const content: any[] = [];

  for (const url of imageUrls) {
    if (url.startsWith("data:")) {
      const [header, data] = url.split(",");
      const mediaType = header.match(/data:(.*?);/)?.[1] || "image/jpeg";
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
    } else {
      try {
        const imgResp = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (imgResp.ok) {
          const buffer = await imgResp.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""),
          );
          const mediaType = imgResp.headers.get("content-type") || "image/jpeg";
          content.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          });
        }
      } catch {
        console.warn(`[callTierVision] Failed to fetch image: ${url.slice(0, 80)}`);
      }
    }
  }

  content.push({ type: "text", text: textMessage });

  const startMs = Date.now();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Anthropic Vision API error (${tier}/${config.model}): ${response.status} — ${errText.slice(0, 500)}`,
    );
  }

  const data = await response.json();
  const durationMs = Date.now() - startMs;

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const costCents =
    (inputTokens * config.costPerInputMTok + outputTokens * config.costPerOutputMTok) / 1_000_000;

  const resultContent = data.content?.[0]?.text ?? "";

  return {
    content: resultContent,
    tier,
    model: config.model,
    inputTokens,
    outputTokens,
    costCents: Math.round(costCents * 10000) / 10000,
    durationMs,
    stopReason: data.stop_reason ?? "unknown",
  };
}
