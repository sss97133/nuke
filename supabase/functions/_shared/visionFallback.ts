// Cloud vision fallback — BYOK-native. Used ONLY when the free YONO sidecar is unavailable.
//
// ECONOMICS (per Skylar, 2026-06-16): Nuke does NOT fund cloud inference. The caller brings the
// compute — their connected Claude / ChatGPT / Gemini subscription or key (stored in
// `user_ai_providers`, resolved by getUserApiKey). They pay. Nuke owns the harness (YONO free
// tier + the consensus engine); the caller owns the inference. The path is: YONO (free) → the
// USER's connected provider (BYOK). Anthropic is a first-class tier because "connect your Claude
// subscription" is a primary flow.
//
// The `system` env-key pool (Nuke's temporary bootstrap) is RETIRED (Skylar, 2026-09-28): every tier
// in it had died — gemini-flash-lite-latest 404 (model gone), claude-haiku-4-5 400, gpt-4o-mini 429 "no
// credits remaining", ~5,900 failed attempts each 2026-09-27 21:00–23:17Z, $0 billed, nothing analyzed.
// getUserApiKey still falls back to env keys for other callers; this module takes only user keys.
//
// When neither YONO nor a user key is available, callers should surface
// "connect your AI subscription to enable analysis" rather than silently spending Nuke's money.

import { callLLM, type LLMConfig } from "./llmProvider.ts";
import { getUserApiKey } from "./getUserApiKey.ts";
import { ProviderHTTPError, VisionProviderUnavailable, safeAnthropicUsage, type AnthropicTokenUsage, type CredentialKind, type ProviderDiagnostic } from "./providerDiagnostic.ts";

type Provider = "google" | "anthropic" | "openai";

// Cheapest-first provider preference; each resolved BYOK-first via getUserApiKey.
const PROVIDER_PREFS: Array<{ provider: Provider; model: string; env: string }> = [
  { provider: "google", model: "gemini-flash-lite-latest", env: "GOOGLE_AI_API_KEY" },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", env: "ANTHROPIC_API_KEY" },
  { provider: "openai", model: "gpt-4o-mini", env: "OPENAI_API_KEY" },
];

interface ResolvedTier extends LLMConfig { keySource: "user" | "system"; credentialKind?: CredentialKind; }
interface VisionDependencies {
  getKey?: typeof getUserApiKey;
  call?: typeof callLLM;
}

// Resolve usable tiers for this caller: the caller's own connected providers (BYOK — caller pays),
// cheapest first. Returns [] when the caller has none; callers then say "connect your AI subscription".
async function resolveTiers(supabase: unknown, userId: string | null, getKey = getUserApiKey) {
  const tiers: ResolvedTier[] = [];
  const diagnostics: ProviderDiagnostic[] = [];
  for (const p of PROVIDER_PREFS) {
    try {
      const r = await getKey(supabase, userId, p.provider, p.env);
      // user keys only: the system pool is retired (header)
      if (r.apiKey && r.source === "user") {
        tiers.push({ provider: p.provider, model: r.modelName || p.model, apiKey: r.apiKey, source: r.source, keySource: r.source,
          credentialKind: r.credentialKind });
      } else if (r.userKeyStatus === "lookup_failed") {
        diagnostics.push({ code: "credential_lookup_failed", provider: p.provider, http_status: null, credential_kind: null });
      } else {
        diagnostics.push({ code: "no_connected_key", provider: p.provider, http_status: null, credential_kind: null });
      }
    } catch {
      diagnostics.push({ code: "credential_lookup_failed", provider: p.provider, http_status: null, credential_kind: null });
    }
  }
  return { tiers, diagnostics };
}

async function toImagePart(imageUrl: string): Promise<{ type: "image_url"; image_url: { url: string } }> {
  try {
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (resp.ok) {
      const buf = new Uint8Array(await resp.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const mime = resp.headers.get("content-type") || "image/jpeg";
      return { type: "image_url", image_url: { url: `data:${mime};base64,${btoa(bin)}` } };
    }
  } catch {
    // fall through to URL pass-through
  }
  return { type: "image_url", image_url: { url: imageUrl } };
}

function parseJson(content: string): unknown | null {
  if (!content) return null;
  let s = content;
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  else {
    const obj = content.match(/\{[\s\S]*\}/);
    if (obj) s = obj[0];
  }
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

interface VisionResult { data: Record<string, unknown>; provider: string; model: string; keySource: "user" | "system"; ms: number; usage: AnthropicTokenUsage | null; }

async function runTiers(tiers: ResolvedTier[], messages: unknown[], maxTokens: number, diagnostics: ProviderDiagnostic[],
  call = callLLM): Promise<VisionResult | null> {
  for (const cfg of tiers) {
    try {
      const r = await call(cfg, messages as never[], { temperature: 0.2, maxTokens, vision: true });
      const usage = cfg.provider === "anthropic" ? safeAnthropicUsage(r.usage) : null;
      // Completed-but-unreadable responses can consume tokens too. Only log
      // numeric counters; never provider prose, keys, prompts or image data.
      if (usage) console.log("[visionFallback] anthropic_token_usage", JSON.stringify(usage));
      const data = parseJson(r.content || "");
      if (data && typeof data === "object") {
        return { data: data as Record<string, unknown>, provider: cfg.provider, model: cfg.model, keySource: cfg.keySource, ms: r.duration_ms ?? 0, usage };
      }
      diagnostics.push({ code: "response_unreadable", provider: cfg.provider, http_status: null, credential_kind: cfg.credentialKind ?? null });
    } catch (e) {
      const diagnostic = e instanceof ProviderHTTPError ? { ...e.diagnostic, credential_kind: cfg.credentialKind ?? null }
        : { code: "request_failed" as const, provider: cfg.provider, http_status: null, credential_kind: cfg.credentialKind ?? null };
      diagnostics.push(diagnostic);
      console.warn(`[visionFallback] ${cfg.provider} failed: ${diagnostic.code}`);
    }
  }
  return null;
}

/** Single-image vision via the caller's BYOK provider. Null if no provider is available. */
export async function cloudVisionJSON(
  supabase: unknown,
  userId: string | null,
  opts: { systemPrompt?: string; userPrompt: string; imageUrl: string; maxTokens?: number },
): Promise<VisionResult | null> {
  const { tiers, diagnostics } = await resolveTiers(supabase, userId);
  if (tiers.length === 0) return null;
  const messages: unknown[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: [{ type: "text", text: opts.userPrompt }, await toImagePart(opts.imageUrl)] });
  return runTiers(tiers, messages, opts.maxTokens ?? 800, diagnostics);
}

/** Multi-image (interleaved text + images) vision via the caller's BYOK provider. */
export async function cloudVisionMultiJSON(
  supabase: unknown,
  userId: string | null,
  opts: { systemPrompt?: string; parts: Array<{ text: string } | { imageUrl: string }>; maxTokens?: number; throwOnUnavailable?: boolean },
  dependencies: VisionDependencies = {},
): Promise<VisionResult | null> {
  const { tiers, diagnostics } = await resolveTiers(supabase, userId, dependencies.getKey);
  if (tiers.length === 0) {
    if (opts.throwOnUnavailable) throw new VisionProviderUnavailable(diagnostics);
    return null;
  }
  const content: unknown[] = [];
  for (const p of opts.parts) {
    if ("text" in p) content.push({ type: "text", text: p.text });
    else content.push(await toImagePart(p.imageUrl));
  }
  const messages: unknown[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content });
  const result = await runTiers(tiers, messages, opts.maxTokens ?? 600, diagnostics, dependencies.call);
  if (!result && opts.throwOnUnavailable) throw new VisionProviderUnavailable(diagnostics);
  return result;
}

export interface CloudAnalyzeResult {
  make: string | null;
  is_vehicle: boolean | null;
  confidence: number;
  vehicle_zone: string | null;
  condition_score: number | null;
  damage_flags: string[];
  modification_flags: string[];
  photo_quality: string | null;
  provider: string;
  model: string;
  keySource: "user" | "system";
  ms: number;
}

const ANALYZE_PROMPT = `You are a vehicle vision model. Look at the image and respond ONLY with valid JSON (no markdown):
{
  "is_vehicle": <true|false>,
  "make": "<manufacturer or null>",
  "confidence": <0.0-1.0 that make is correct>,
  "vehicle_zone": "<one of: ext_front, ext_rear, ext_side, ext_three_quarter, interior_dashboard, interior_seats, engine_bay, undercarriage, wheel, detail, document, other>",
  "condition_score": <1-5 where 5 is concours, 1 is project; null if not a vehicle>,
  "damage_flags": [<"rust"|"dent"|"scratch"|"crack"|"missing_part"|... or empty>],
  "modification_flags": [<"aftermarket_wheels"|"lowered"|"body_kit"|... or empty>],
  "photo_quality": "<high|medium|low>"
}`;

/** Analyze an image via the caller's BYOK provider, shaped like the YONO /analyze response. */
export async function cloudAnalyze(supabase: unknown, userId: string | null, imageUrl: string): Promise<CloudAnalyzeResult | null> {
  const r = await cloudVisionJSON(supabase, userId, { userPrompt: ANALYZE_PROMPT, imageUrl, maxTokens: 600 });
  if (!r) return null;
  const d = r.data;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    make: (d.make as string) ?? null,
    is_vehicle: typeof d.is_vehicle === "boolean" ? d.is_vehicle : null,
    confidence: typeof d.confidence === "number" ? d.confidence : 0.5,
    vehicle_zone: (d.vehicle_zone as string) ?? null,
    condition_score: typeof d.condition_score === "number" ? d.condition_score : null,
    damage_flags: arr(d.damage_flags),
    modification_flags: arr(d.modification_flags),
    photo_quality: (d.photo_quality as string) ?? null,
    provider: r.provider,
    model: r.model,
    keySource: r.keySource,
    ms: r.ms,
  };
}
