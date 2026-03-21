/**
 * Unified LLM Router — Single entry point for all LLM calls across the platform.
 *
 * Replaces:
 * - agentTiers.ts (Anthropic-only callTier)
 * - llmProvider.ts (unused multi-provider)
 * - Inline fetch() calls in enrich-vehicle-profile-ai, image-ai-chat
 * - Script-side provider dispatch
 *
 * Supports:
 * - Anthropic (Haiku, Sonnet, Opus)
 * - OpenAI (GPT-4o, GPT-4o-mini)
 * - Ollama local (nuke, nuke-agent, qwen3, qwen2.5)
 * - Ollama cloud (Kimi K2.5)
 * - Modal (Qwen vLLM server)
 * - Google (Gemini)
 * - xAI (Grok)
 * - Groq (Llama)
 *
 * Every call returns provenance metadata (agentTier, model, cost)
 * for the observation system's agent_tier tracking.
 */

// ── Types ────────────────────────────────────────────────────

export type LLMProvider =
  | "anthropic"
  | "openai"
  | "ollama"
  | "ollama-cloud"
  | "modal"
  | "google"
  | "xai"
  | "groq";

export type ModelQuality = "basic" | "good" | "excellent" | "expert";
export type ModelSpeed = "fast" | "medium" | "slow";

export interface ModelEntry {
  id: string;
  provider: LLMProvider;
  displayName: string;
  costPerInputMTok: number;
  costPerOutputMTok: number;
  maxContext: number;
  maxOutput: number;
  supportsVision: boolean;
  supportsJson: boolean;
  speed: ModelSpeed;
  quality: ModelQuality;
  isLocal: boolean;
  endpoint: string;
  timeoutMs: number;
}

export interface TaskRequirements {
  task: string;
  minQuality?: ModelQuality;
  maxCostCentsPerCall?: number;
  needsVision?: boolean;
  needsJson?: boolean;
  preferLocal?: boolean;
  minContext?: number;
  fallbackChain?: string[];
}

export interface LLMCallResult {
  content: string;
  provider: LLMProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
  stopReason: string;
  /** For observation system provenance */
  agentTier: string;
}

// Backward compat with agentTiers.ts
export type AgentTier = "haiku" | "sonnet" | "opus";
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

// ── Model Registry ───────────────────────────────────────────

const QUALITY_ORDER: Record<ModelQuality, number> = {
  basic: 1, good: 2, excellent: 3, expert: 4,
};

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    displayName: "Haiku 4.5",
    costPerInputMTok: 1.00,
    costPerOutputMTok: 5.00,
    maxContext: 200_000,
    maxOutput: 4096,
    supportsVision: true,
    supportsJson: true,
    speed: "fast",
    quality: "good",
    isLocal: false,
    endpoint: "https://api.anthropic.com/v1/messages",
    timeoutMs: 30_000,
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "Sonnet 4.6",
    costPerInputMTok: 3.00,
    costPerOutputMTok: 15.00,
    maxContext: 200_000,
    maxOutput: 8192,
    supportsVision: true,
    supportsJson: true,
    speed: "medium",
    quality: "excellent",
    isLocal: false,
    endpoint: "https://api.anthropic.com/v1/messages",
    timeoutMs: 60_000,
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    provider: "anthropic",
    displayName: "Opus 4.6",
    costPerInputMTok: 5.00,
    costPerOutputMTok: 25.00,
    maxContext: 200_000,
    maxOutput: 16384,
    supportsVision: true,
    supportsJson: true,
    speed: "slow",
    quality: "expert",
    isLocal: false,
    endpoint: "https://api.anthropic.com/v1/messages",
    timeoutMs: 120_000,
  },
  "nuke-agent": {
    id: "nuke-agent",
    provider: "ollama",
    displayName: "Nuke Agent (fine-tuned)",
    costPerInputMTok: 0,
    costPerOutputMTok: 0,
    maxContext: 8192,
    maxOutput: 4096,
    supportsVision: false,
    supportsJson: true,
    speed: "fast",
    quality: "good",
    isLocal: true,
    endpoint: "http://127.0.0.1:11434",
    timeoutMs: 60_000,
  },
  "nuke": {
    id: "nuke",
    provider: "ollama",
    displayName: "Nuke (DeepSeek R1 32B)",
    costPerInputMTok: 0,
    costPerOutputMTok: 0,
    maxContext: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsJson: true,
    speed: "medium",
    quality: "excellent",
    isLocal: true,
    endpoint: "http://127.0.0.1:11434",
    timeoutMs: 120_000,
  },
  "qwen3-30b": {
    id: "qwen3:30b-a3b",
    provider: "ollama",
    displayName: "Qwen3 30B MoE",
    costPerInputMTok: 0,
    costPerOutputMTok: 0,
    maxContext: 32768,
    maxOutput: 8192,
    supportsVision: false,
    supportsJson: true,
    speed: "fast",
    quality: "good",
    isLocal: true,
    endpoint: "http://127.0.0.1:11434",
    timeoutMs: 60_000,
  },
  "qwen2.5-7b": {
    id: "qwen2.5:7b",
    provider: "ollama",
    displayName: "Qwen2.5 7B",
    costPerInputMTok: 0,
    costPerOutputMTok: 0,
    maxContext: 8192,
    maxOutput: 4096,
    supportsVision: false,
    supportsJson: true,
    speed: "fast",
    quality: "basic",
    isLocal: true,
    endpoint: "http://127.0.0.1:11434",
    timeoutMs: 30_000,
  },
  "kimi-k2.5": {
    id: "kimi-k2.5:cloud",
    provider: "ollama-cloud",
    displayName: "Kimi K2.5 (cloud)",
    costPerInputMTok: 0,
    costPerOutputMTok: 0,
    maxContext: 256_000,
    maxOutput: 16384,
    supportsVision: true,
    supportsJson: true,
    speed: "medium",
    quality: "expert",
    isLocal: false,
    endpoint: "http://127.0.0.1:11434",
    timeoutMs: 120_000,
  },
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    displayName: "GPT-4o",
    costPerInputMTok: 2.50,
    costPerOutputMTok: 10.00,
    maxContext: 128_000,
    maxOutput: 16384,
    supportsVision: true,
    supportsJson: true,
    speed: "medium",
    quality: "excellent",
    isLocal: false,
    endpoint: "https://api.openai.com/v1/chat/completions",
    timeoutMs: 60_000,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    displayName: "GPT-4o Mini",
    costPerInputMTok: 0.15,
    costPerOutputMTok: 0.60,
    maxContext: 128_000,
    maxOutput: 16384,
    supportsVision: true,
    supportsJson: true,
    speed: "fast",
    quality: "good",
    isLocal: false,
    endpoint: "https://api.openai.com/v1/chat/completions",
    timeoutMs: 30_000,
  },
  "qwen2.5-7b-modal": {
    id: "Qwen/Qwen2.5-7B-Instruct",
    provider: "modal",
    displayName: "Qwen2.5 7B (Modal T4)",
    costPerInputMTok: 0.10,
    costPerOutputMTok: 0.10,
    maxContext: 8192,
    maxOutput: 4096,
    supportsVision: false,
    supportsJson: true,
    speed: "fast",
    quality: "basic",
    isLocal: false,
    endpoint: "https://sss97133--nuke-vllm-serve.modal.run/v1/chat/completions",
    timeoutMs: 120_000,
  },
  "gemini-flash": {
    id: "gemini-2.0-flash-lite",
    provider: "google",
    displayName: "Gemini Flash Lite",
    costPerInputMTok: 0,
    costPerOutputMTok: 0,
    maxContext: 1_000_000,
    maxOutput: 8192,
    supportsVision: true,
    supportsJson: true,
    speed: "fast",
    quality: "good",
    isLocal: false,
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    timeoutMs: 30_000,
  },
};

// ── Task Routing ─────────────────────────────────────────────

const TASK_DEFAULTS: Record<string, { model: string; fallback: string }> = {
  title_parsing:      { model: "nuke-agent",      fallback: "claude-haiku-4-5" },
  extraction:         { model: "nuke-agent",      fallback: "claude-haiku-4-5" },
  quality_review:     { model: "claude-sonnet-4-6", fallback: "kimi-k2.5" },
  market_strategy:    { model: "kimi-k2.5",       fallback: "claude-opus-4-6" },
  batch_enrichment:   { model: "qwen3-30b",       fallback: "nuke-agent" },
  comment_mining:     { model: "nuke-agent",      fallback: "qwen2.5-7b" },
  image_analysis:     { model: "claude-haiku-4-5", fallback: "gpt-4o" },
  expert_chat:        { model: "claude-sonnet-4-6", fallback: "kimi-k2.5" },
  coaching:           { model: "claude-sonnet-4-6", fallback: "kimi-k2.5" },
  listing_generation: { model: "claude-sonnet-4-6", fallback: "kimi-k2.5" },
  description_discovery: { model: "nuke-agent",   fallback: "qwen2.5-7b" },
};

// ── Model Selection ──────────────────────────────────────────

export function selectModel(req: TaskRequirements): ModelEntry {
  // 1. Explicit fallback chain
  if (req.fallbackChain?.length) {
    for (const id of req.fallbackChain) {
      const model = MODEL_REGISTRY[id];
      if (model && meetsRequirements(model, req)) return model;
    }
  }

  // 2. Task-based default
  const taskDefault = TASK_DEFAULTS[req.task];
  if (taskDefault) {
    const primary = MODEL_REGISTRY[taskDefault.model];
    if (primary && meetsRequirements(primary, req) && isAvailable(primary)) {
      return primary;
    }
    const fallback = MODEL_REGISTRY[taskDefault.fallback];
    if (fallback && meetsRequirements(fallback, req)) {
      return fallback;
    }
  }

  // 3. Best fit from registry
  const candidates = Object.values(MODEL_REGISTRY)
    .filter((m) => meetsRequirements(m, req))
    .sort((a, b) => {
      // Prefer local if requested
      if (req.preferLocal) {
        if (a.isLocal && !b.isLocal) return -1;
        if (!a.isLocal && b.isLocal) return 1;
      }
      // Then cheapest
      const costA = a.costPerInputMTok + a.costPerOutputMTok;
      const costB = b.costPerInputMTok + b.costPerOutputMTok;
      return costA - costB;
    });

  if (candidates.length > 0) return candidates[0];

  // 4. Absolute fallback
  return MODEL_REGISTRY["claude-haiku-4-5"];
}

function meetsRequirements(model: ModelEntry, req: TaskRequirements): boolean {
  if (req.needsVision && !model.supportsVision) return false;
  if (req.needsJson && !model.supportsJson) return false;
  if (req.minContext && model.maxContext < req.minContext) return false;
  if (req.minQuality && QUALITY_ORDER[model.quality] < QUALITY_ORDER[req.minQuality]) return false;
  return true;
}

function isAvailable(model: ModelEntry): boolean {
  // Local models: check if OLLAMA_URL is set (script context) or skip (edge function)
  if (model.isLocal) {
    try {
      const ollamaUrl = Deno.env.get("OLLAMA_URL");
      return !!ollamaUrl;
    } catch {
      // Not in Deno context, assume available (Node.js scripts)
      return true;
    }
  }
  return true;
}

// ── Provider Dispatch ────────────────────────────────────────

export async function callModel(
  modelKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  },
): Promise<LLMCallResult> {
  const model = MODEL_REGISTRY[modelKey];
  if (!model) throw new Error(`Unknown model: ${modelKey}`);

  const maxTokens = options?.maxTokens ?? model.maxOutput;
  const temperature = options?.temperature ?? 0.1;
  const startMs = Date.now();

  let result: LLMCallResult;

  switch (model.provider) {
    case "anthropic":
      result = await callAnthropic(model, systemPrompt, userMessage, maxTokens, temperature);
      break;
    case "openai":
    case "modal":
    case "groq":
    case "xai":
      result = await callOpenAICompatible(model, systemPrompt, userMessage, maxTokens, temperature, options?.jsonMode);
      break;
    case "ollama":
    case "ollama-cloud":
      result = await callOllama(model, systemPrompt, userMessage, maxTokens, temperature);
      break;
    case "google":
      result = await callGoogle(model, systemPrompt, userMessage, maxTokens, temperature);
      break;
    default:
      throw new Error(`Unsupported provider: ${model.provider}`);
  }

  result.durationMs = Date.now() - startMs;
  return result;
}

/**
 * Route to best model based on task requirements, then call it.
 */
export async function routeAndCall(
  systemPrompt: string,
  userMessage: string,
  requirements: TaskRequirements,
  options?: {
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  },
): Promise<LLMCallResult> {
  const model = selectModel(requirements);
  const modelKey = Object.entries(MODEL_REGISTRY).find(([_, v]) => v.id === model.id)?.[0];
  if (!modelKey) throw new Error(`Model ${model.id} not in registry`);
  return callModel(modelKey, systemPrompt, userMessage, options);
}

/**
 * Backward-compatible wrapper for existing callTier() callers.
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
  const modelMap: Record<AgentTier, string> = {
    haiku: "claude-haiku-4-5",
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
  };

  const result = await callModel(modelMap[tier], systemPrompt, userMessage, options);

  return {
    content: result.content,
    tier,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costCents: result.costCents,
    durationMs: result.durationMs,
    stopReason: result.stopReason,
  };
}

// ── Provider Implementations ─────────────────────────────────

async function callAnthropic(
  model: ModelEntry,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
): Promise<LLMCallResult> {
  const apiKey = getEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const response = await fetch(model.endpoint, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(model.timeoutMs),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic ${model.displayName}: ${response.status} — ${err.slice(0, 300)}`);
  }

  const data = await response.json();
  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;

  return {
    content: data.content?.[0]?.text ?? "",
    provider: "anthropic",
    model: model.id,
    inputTokens,
    outputTokens,
    costCents: computeCost(model, inputTokens, outputTokens),
    durationMs: 0,
    stopReason: data.stop_reason ?? "unknown",
    agentTier: model.displayName.toLowerCase().split(" ")[0],
  };
}

async function callOpenAICompatible(
  model: ModelEntry,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
  jsonMode?: boolean,
): Promise<LLMCallResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // Auth varies by provider
  if (model.provider === "openai") {
    const key = getEnv("OPENAI_API_KEY");
    if (!key) throw new Error("OPENAI_API_KEY not set");
    headers["Authorization"] = `Bearer ${key}`;
  } else if (model.provider === "groq") {
    const key = getEnv("GROQ_API_KEY");
    if (key) headers["Authorization"] = `Bearer ${key}`;
  } else if (model.provider === "xai") {
    const key = getEnv("XAI_API_KEY");
    if (key) headers["Authorization"] = `Bearer ${key}`;
  }
  // Modal: no auth needed for our endpoint

  const body: Record<string, unknown> = {
    model: model.id,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(model.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(model.timeoutMs),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${model.provider} ${model.displayName}: ${response.status} — ${err.slice(0, 300)}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return {
    content: choice?.message?.content ?? "",
    provider: model.provider,
    model: model.id,
    inputTokens,
    outputTokens,
    costCents: computeCost(model, inputTokens, outputTokens),
    durationMs: 0,
    stopReason: choice?.finish_reason ?? "unknown",
    agentTier: model.displayName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
  };
}

async function callOllama(
  model: ModelEntry,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
): Promise<LLMCallResult> {
  const ollamaUrl = getEnv("OLLAMA_URL") || model.endpoint;

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.id,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    }),
    signal: AbortSignal.timeout(model.timeoutMs),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ollama ${model.displayName}: ${response.status} — ${err.slice(0, 300)}`);
  }

  const data = await response.json();

  return {
    content: data.message?.content ?? "",
    provider: model.provider as LLMProvider,
    model: model.id,
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
    costCents: 0,
    durationMs: 0,
    stopReason: data.done_reason ?? "stop",
    agentTier: model.displayName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
  };
}

async function callGoogle(
  model: ModelEntry,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
): Promise<LLMCallResult> {
  const apiKey = getEnv("GOOGLE_AI_API_KEY") || getEnv("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY not set");

  const url = `${model.endpoint}/models/${model.id}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    }),
    signal: AbortSignal.timeout(model.timeoutMs),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google ${model.displayName}: ${response.status} — ${err.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const usage = data.usageMetadata ?? {};

  return {
    content: text,
    provider: "google",
    model: model.id,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    costCents: 0,
    durationMs: 0,
    stopReason: data.candidates?.[0]?.finishReason ?? "unknown",
    agentTier: "gemini-flash",
  };
}

// ── Utilities ────────────────────────────────────────────────

function computeCost(model: ModelEntry, inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens * model.costPerInputMTok + outputTokens * model.costPerOutputMTok) / 1_000_000;
  return Math.round(cost * 10000) / 10000;
}

function getEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    // Node.js fallback
    return (globalThis as any).process?.env?.[key];
  }
}

/**
 * Parse JSON from an LLM response, handling markdown code blocks.
 * Re-exported from agentTiers for backward compat.
 */
export function parseJsonResponse<T = unknown>(raw: string): T {
  try { return JSON.parse(raw); } catch { /* */ }

  const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch { /* */ }
  }

  const jsonMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch { /* */ }
  }

  throw new Error(`Failed to parse JSON from LLM response: ${raw.slice(0, 200)}...`);
}

// ── Re-exports for backward compatibility ────────────────────
// These match the agentTiers.ts API so existing imports keep working

export { QUALITY_ORDER as _QUALITY_ORDER };

export const TIER_CONFIGS = {
  haiku: MODEL_REGISTRY["claude-haiku-4-5"],
  sonnet: MODEL_REGISTRY["claude-sonnet-4-6"],
  opus: MODEL_REGISTRY["claude-opus-4-6"],
};

export const QUALITY_THRESHOLDS = {
  MIN_FIELDS: 3,
  MIN_YMM_CONFIDENCE: 0.8,
  ESCALATION_THRESHOLD: 0.6,
  AUTO_APPROVE_THRESHOLD: 0.9,
  MAX_NULL_RATIO: 0.5,
};

export function classifyTaskTier(
  taskType: string,
  context?: { htmlLength?: number; hasStructuredData?: boolean; previousFailures?: number; isEdgeCase?: boolean },
): AgentTier {
  const opusTasks = ["source_prioritization", "market_intelligence", "pipeline_optimization"];
  if (opusTasks.includes(taskType)) return "opus";
  if (context?.previousFailures && context.previousFailures >= 2) return "sonnet";
  if (context?.isEdgeCase) return "sonnet";
  const sonnetTasks = ["quality_review", "edge_case_resolution", "batch_aggregation", "description_deep_analysis"];
  if (sonnetTasks.includes(taskType)) return "sonnet";
  return "haiku";
}

export function estimateBatchCost(
  tier: AgentTier,
  itemCount: number,
  avgInputTokens = 1500,
  avgOutputTokens = 500,
): { totalCostCents: number; perItemCostCents: number } {
  const modelMap: Record<AgentTier, string> = { haiku: "claude-haiku-4-5", sonnet: "claude-sonnet-4-6", opus: "claude-opus-4-6" };
  const model = MODEL_REGISTRY[modelMap[tier]];
  const totalInput = itemCount * avgInputTokens;
  const totalOutput = itemCount * avgOutputTokens;
  const totalCostCents = (totalInput * model.costPerInputMTok + totalOutput * model.costPerOutputMTok) / 1_000_000;
  return {
    totalCostCents: Math.round(totalCostCents * 100) / 100,
    perItemCostCents: Math.round((totalCostCents / itemCount) * 10000) / 10000,
  };
}

// Re-export callTierVision from the original for now
// TODO: integrate vision into routeAndCall with ContentBlock[] support
export { callTier as callTierCompat };
