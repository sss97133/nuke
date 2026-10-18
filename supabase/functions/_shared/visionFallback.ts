// Legacy cloud fallback remains BYOK. Customer subject resolution uses the
// separate wallet-reserved platformVisionMultiJSON path below (owner, 2026-10-18).
//
// LEGACY FALLBACK ECONOMICS (2026-06-16; not the customer subject-resolution path): the caller brings the
// compute — their connected Claude / ChatGPT / Gemini subscription or key (stored in
// `user_ai_providers`, resolved by getUserApiKey). They pay. Nuke owns the harness (YONO free
// tier + the consensus engine); the caller owns the inference. The path is: YONO (free) → the
// USER's connected provider (BYOK). Anthropic is a first-class tier because "connect your Claude
// subscription" is a primary flow.
//
// The `system` env-key pool (Nuke's temporary bootstrap) is RETIRED (Skylar, 2026-09-28): every tier
// in it had died — gemini-flash-lite-latest 404 (model gone), claude-haiku-4-5 400, gpt-4o-mini 429 "no
// credits remaining", ~5,900 failed attempts each 2026-09-27 21:00–23:17Z, $0 billed, nothing analyzed.
// getUserApiKey still falls back to env keys for other callers; resolveTiers takes only user keys.
//
// When neither YONO nor a user key is available, legacy fallback callers surface
// "connect your AI subscription to enable analysis" rather than silently spending Nuke's money.

import { callLLM, type LLMConfig } from "./llmProvider.ts";
import { getUserApiKey } from "./getUserApiKey.ts";
import { ProviderHTTPError, VisionProviderUnavailable, safeAnthropicUsage, type AnthropicTokenUsage, type CredentialKind, type ProviderDiagnostic } from "./providerDiagnostic.ts";
import { reserveCredits, settleHold, estimateCents, usageToCents } from "./aiCredits.ts";
import type { PlatformAnalysisBilling } from "./providerDiagnostic.ts";

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

interface VisionResult { data: Record<string, unknown>; provider: string; model: string; keySource: "user" | "system"; ms: number; usage: AnthropicTokenUsage | null; billing?: PlatformAnalysisBilling;
  settleBilling?: (readingRetained: boolean) => Promise<PlatformAnalysisBilling>; }

/** Customer photo analysis uses Nuke's server key, never a customer's provider row.
 * No automatic provider/model fallback may spend beyond this reservation.
 * Image custody/permission is established by the existing subject service first.
 */
export async function platformVisionMultiJSON(
  supabase: unknown, userId: string,
  opts: { parts: Array<{ text: string } | { imageUrl: string }>; maxTokens: number },
  deps: { call?: typeof callLLM; env?: (name: string) => string | undefined;
    reserve?: typeof reserveCredits; settle?: typeof settleHold } = {},
): Promise<VisionResult> {
  const fail = (code: ProviderDiagnostic["code"], status: number | null = null): never => {
    throw new VisionProviderUnavailable([{ code, provider: "anthropic", http_status: status, credential_kind: null }], "platform");
  };
  const images = opts.parts.filter((part): part is { imageUrl: string } => "imageUrl" in part);
  const textBytes = opts.parts.reduce((sum, part) => sum + ("text" in part ? new TextEncoder().encode(part.text).length : 0), 0);
  if (!userId || !Number.isSafeInteger(opts.maxTokens) || opts.maxTokens < 1 || opts.maxTokens > 1600 ||
      images.length < 2 || images.length > 14 || opts.parts.length > 29 || textBytes > 8000 ||
      images.some(part => !part.imageUrl.startsWith("data:image/jpeg;base64,"))) return fail("platform_unavailable");
  const env = deps.env ?? (name => Deno.env.get(name));
  const apiKey = env("NUKE_PHOTO_ANTHROPIC_API_KEY");
  if (!apiKey) return fail("platform_not_configured");
  const model = "claude-haiku-5-5";
  const margin = Number(env("AI_CREDIT_MARGIN") ?? "1.2");
  if (!Number.isFinite(margin) || margin < 1 || margin > 10) return fail("platform_unavailable");
  // Each high-resolution image is capped at4,784 visual tokens. Pinned subject
  // inputs plus bounded text fit below80k, retaining the <=100k pricing tier.
  const inputCeiling = 80_000;
  const reservation = estimateCents(model, inputCeiling, opts.maxTokens, margin);
  const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  const hashes = await Promise.all(images.map(image => digest(image.imageUrl)));
  const ref = "photo:v1:" + await digest(JSON.stringify({ model, hashes: hashes.sort() }));
  let hold: Awaited<ReturnType<typeof reserveCredits>>;
  try { hold = await (deps.reserve ?? reserveCredits)(supabase, userId, reservation, ref, { model, source: "nuke_photo_analysis_v1" }); }
  catch { return fail("platform_unavailable"); }
  if (hold.status !== "reserved") return fail(hold.status === "insufficient_funds" ? "analysis_balance_required" : "analysis_pending");
  const settle = deps.settle ?? settleHold;
  let response: any;
  try {
    response = await (deps.call ?? callLLM)({ provider: "anthropic", model, apiKey, source: "system",
      workspaceId: env("NUKE_PHOTO_ANTHROPIC_WORKSPACE_ID") },
      [{ role: "user", content: opts.parts.map(part => "text" in part ? { type: "text", text: part.text }
        : { type: "image_url", image_url: { url: part.imageUrl } }) }], { maxTokens: opts.maxTokens, vision: true });
  } catch (error) {
    const status = error instanceof ProviderHTTPError ? error.diagnostic.http_status : null;
    // Transport/server ambiguity retains the reservation. Never free it then
    // silently make another paid call whose first result may already exist.
    if (status !== null && status >= 400 && status < 500) {
      try { await settle(supabase, userId, hold.hold_id, 0, { provider_read: "not_started", http_status: status, model }); }
      catch { return fail("analysis_pending"); }
    }
    return fail("platform_unavailable", status);
  }
  const usage = safeAnthropicUsage(response.usage);
  if (usage) console.log("[platformVision] anthropic_token_usage", JSON.stringify(usage));
  const parsed = parseJson(response.content || "");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    try { await settle(supabase, userId, hold.hold_id, 0, { provider_read: "unreadable", model, usage }); }
    catch { return fail("analysis_pending"); }
    return fail("platform_result_unreadable");
  }
  const billing: PlatformAnalysisBilling = { source: "nuke_wallet", status: "pending", hold_id: hold.hold_id, charged_cents: null };
  // Settle only after protected storage acknowledges the complete interpretation.
  // Storage/usage ambiguity keeps a reservation, never a second paid inference.
  const settleBilling = async (readingRetained: boolean): Promise<PlatformAnalysisBilling> => {
    if (!readingRetained || !usage || usage.input_tokens > inputCeiling || usage.output_tokens > opts.maxTokens ||
        (usage.cache_creation_input_tokens ?? 0) !== 0 || (usage.cache_read_input_tokens ?? 0) !== 0) return billing;
    const actual = usageToCents(model, usage, margin);
    try { await settle(supabase, userId, hold.hold_id, actual, { provider_read: "completed", model, usage });
      return { ...billing, status: "settled", charged_cents: actual }; }
    catch { console.warn("[platformVision] settlement_pending"); return billing; }
  };
  return { data: parsed as Record<string, unknown>, provider: "anthropic", model, keySource: "system", ms: response.duration_ms ?? 0,
    usage, billing, settleBilling };
}

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
