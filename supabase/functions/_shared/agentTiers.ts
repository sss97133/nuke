/**
 * Agent Tier System — Shared module for Haiku/Sonnet/Opus hierarchy
 *
 * Tier routing:
 *   Haiku  (claude-haiku-4-5-20251001) — routine extraction, field parsing, simple classification
 *   Sonnet (claude-sonnet-4-6) — quality review, edge cases, aggregation, escalation decisions
 *   Opus   (claude-opus-4-6) — strategy, source prioritization, market intelligence synthesis
 *
 * Cost comparison (per 1M tokens input/output):
 *   Haiku:  $1.00 / $5.00   — 3x cheaper than Sonnet for routine work
 *   Sonnet: $3.00 / $15.00
 *   Opus:   $5.00 / $25.00
 */

export type AgentTier = "haiku" | "sonnet" | "opus";

export interface TierConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  costPerInputMTok: number;
  costPerOutputMTok: number;
  /** Typical use cases */
  useCases: string[];
  /** Max timeout for API call in ms */
  timeoutMs: number;
}

export const TIER_CONFIGS: Record<AgentTier, TierConfig> = {
  haiku: {
    model: "claude-haiku-4-5-20251001",
    maxTokens: 4096,
    temperature: 0.0,
    costPerInputMTok: 1.00,
    costPerOutputMTok: 5.00,
    useCases: [
      "field extraction from HTML/markdown",
      "VIN parsing",
      "simple classification (auction type, vehicle category)",
      "price parsing",
      "date extraction",
      "listing title parsing into year/make/model",
    ],
    timeoutMs: 30_000,
  },
  sonnet: {
    model: "claude-sonnet-4-6",
    maxTokens: 8192,
    temperature: 0.1,
    costPerInputMTok: 3.00,
    costPerOutputMTok: 15.00,
    useCases: [
      "quality review of Haiku extractions",
      "edge case resolution",
      "multi-field consistency validation",
      "description analysis for hidden details",
      "escalation decisions",
      "batch result aggregation",
    ],
    timeoutMs: 60_000,
  },
  opus: {
    model: "claude-opus-4-6",
    maxTokens: 16384,
    temperature: 0.2,
    costPerInputMTok: 5.00,
    costPerOutputMTok: 25.00,
    useCases: [
      "source prioritization strategy",
      "market intelligence synthesis",
      "YONO retraining decisions",
      "extraction pipeline optimization",
      "cross-source deduplication strategy",
    ],
    timeoutMs: 120_000,
  },
};

export interface AgentCallResult {
  content: string;
  tier: AgentTier;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
  stopReason: string;
}

/**
 * Call the Anthropic API at a given tier.
 */
export async function callTier(
  tier: AgentTier,
  systemPrompt: string,
  userMessage: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  },
): Promise<AgentCallResult> {
  const config = TIER_CONFIGS[tier];
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const maxTokens = options?.maxTokens ?? config.maxTokens;
  const temperature = options?.temperature ?? config.temperature;

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
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Anthropic API error (${tier}/${config.model}): ${response.status} — ${errText.slice(0, 500)}`,
    );
  }

  const data = await response.json();
  const durationMs = Date.now() - startMs;

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const costCents =
    (inputTokens * config.costPerInputMTok) / 1_000_000 / 100 +
    (outputTokens * config.costPerOutputMTok) / 1_000_000 / 100;

  const content = data.content?.[0]?.text ?? "";

  return {
    content,
    tier,
    model: config.model,
    inputTokens,
    outputTokens,
    costCents: Math.round(costCents * 10000) / 10000, // 4 decimal places
    durationMs,
    stopReason: data.stop_reason ?? "unknown",
  };
}

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
  const config = TIER_CONFIGS[tier];
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const maxTokens = options?.maxTokens ?? config.maxTokens;
  const temperature = options?.temperature ?? config.temperature;

  // Build content array with images + text
  const content: any[] = [];

  for (const url of imageUrls) {
    // For Anthropic API, we need to fetch the image and send as base64
    // or use the URL source type
    if (url.startsWith("data:")) {
      // Already base64
      const [header, data] = url.split(",");
      const mediaType = header.match(/data:(.*?);/)?.[1] || "image/jpeg";
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
    } else {
      // Fetch image and convert to base64
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
        // Skip failed image downloads
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
    (inputTokens * config.costPerInputMTok) / 1_000_000 / 100 +
    (outputTokens * config.costPerOutputMTok) / 1_000_000 / 100;

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

/**
 * Parse JSON from an LLM response, handling markdown code blocks.
 */
export function parseJsonResponse<T = any>(raw: string): T {
  // Try raw first
  try {
    return JSON.parse(raw);
  } catch {
    // ignore
  }

  // Try extracting from markdown code block
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // ignore
    }
  }

  // Try finding first { ... } or [ ... ]
  const jsonMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // ignore
    }
  }

  throw new Error(`Failed to parse JSON from LLM response: ${raw.slice(0, 200)}...`);
}

/**
 * Determine the appropriate tier for a task based on its type and complexity.
 */
export function classifyTaskTier(taskType: string, context?: {
  htmlLength?: number;
  hasStructuredData?: boolean;
  previousFailures?: number;
  isEdgeCase?: boolean;
}): AgentTier {
  // Always use Opus for strategy tasks
  const opusTasks = [
    "source_prioritization",
    "market_intelligence",
    "pipeline_optimization",
    "yono_retraining_decision",
    "cross_source_dedup_strategy",
  ];
  if (opusTasks.includes(taskType)) return "opus";

  // Escalate to Sonnet if there have been previous failures or it's an edge case
  if (context?.previousFailures && context.previousFailures >= 2) return "sonnet";
  if (context?.isEdgeCase) return "sonnet";

  // Sonnet tasks — quality review, aggregation, complex analysis
  const sonnetTasks = [
    "quality_review",
    "edge_case_resolution",
    "batch_aggregation",
    "description_deep_analysis",
    "escalation_decision",
    "multi_field_validation",
  ];
  if (sonnetTasks.includes(taskType)) return "sonnet";

  // Everything else defaults to Haiku
  return "haiku";
}

/**
 * Estimate the cost of processing a batch of items at a given tier.
 * Assumes ~1500 input tokens and ~500 output tokens per extraction.
 */
export function estimateBatchCost(
  tier: AgentTier,
  itemCount: number,
  avgInputTokens = 1500,
  avgOutputTokens = 500,
): { totalCostCents: number; perItemCostCents: number } {
  const config = TIER_CONFIGS[tier];
  const totalInput = itemCount * avgInputTokens;
  const totalOutput = itemCount * avgOutputTokens;
  const totalCostCents =
    (totalInput * config.costPerInputMTok + totalOutput * config.costPerOutputMTok) / 1_000_000;
  return {
    totalCostCents: Math.round(totalCostCents * 100) / 100,
    perItemCostCents: Math.round((totalCostCents / itemCount) * 10000) / 10000,
  };
}

/**
 * Quality score thresholds for supervisor review decisions.
 */
export const QUALITY_THRESHOLDS = {
  /** Minimum fields required for a valid extraction */
  MIN_FIELDS: 3,
  /** Minimum confidence for year/make/model extraction */
  MIN_YMM_CONFIDENCE: 0.8,
  /** Haiku results below this quality score get escalated to Sonnet */
  ESCALATION_THRESHOLD: 0.6,
  /** Results above this are auto-approved without supervisor review */
  AUTO_APPROVE_THRESHOLD: 0.9,
  /** Maximum acceptable null ratio for key fields */
  MAX_NULL_RATIO: 0.5,
};
