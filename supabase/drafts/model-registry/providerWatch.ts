// DRAFT — not deployed. Weekly provider watch (target: supabase/functions/model-provider-watch).
// Reads each provider's model-list endpoint (free; no tokens spent), then:
//   1. new model ids that look relevant  -> model_queue_candidate(...) as status 'candidate' (inert)
//   2. shutdown / deprecation dates       -> provider_deprecated_at / provider_shutdown_at on matching rows
//   3. model_retire_expired()             -> retire anything past shutdown; auto-fallback if it was active
//   4. returns a digest the weekly routine sends to Skylar (new candidates, upcoming shutdowns <= 60 days)
// It never moves anything to shadow/active and never calls a model.
//
// Proposed schedule (commented, not applied):
//   select cron.schedule('model-provider-watch', '0 17 * * 1',  -- Mondays 09:00 PST
//     $$ select net.http_post(url := '<project>/functions/v1/model-provider-watch', headers := '{"Authorization":"Bearer <service key from vault>"}'::jsonb) $$);

type Listed = { provider: string; id: string; created?: string; shutdown_date?: string | null; vision?: boolean };

const SOURCES: Array<{ provider: string; url: string; env: string; auth: (k: string) => Record<string, string>; parse: (j: any) => Listed[] }> = [
  { provider: "openai", url: "https://api.openai.com/v1/models", env: "OPENAI_API_KEY", auth: (k) => ({ Authorization: `Bearer ${k}` }),
    // OpenAI documents an optional shutdown_date on each model in GET /v1/models.
    parse: (j) => (j.data ?? []).map((m: any) => ({ provider: "openai", id: m.id, created: m.created ? new Date(m.created * 1000).toISOString() : undefined, shutdown_date: m.shutdown_date ?? null })) },
  { provider: "anthropic", url: "https://api.anthropic.com/v1/models?limit=100", env: "ANTHROPIC_API_KEY",
    auth: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
    parse: (j) => (j.data ?? []).map((m: any) => ({ provider: "anthropic", id: m.id, created: m.created_at })) },
  { provider: "google", url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", env: "GOOGLE_AI_API_KEY",
    auth: (k) => ({ "x-goog-api-key": k }),
    parse: (j) => (j.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => ({ provider: "google", id: String(m.name).replace(/^models\//, "") })) },
  { provider: "xai", url: "https://api.x.ai/v1/models", env: "XAI_API_KEY", auth: (k) => ({ Authorization: `Bearer ${k}` }),
    parse: (j) => (j.data ?? []).map((m: any) => ({ provider: "xai", id: m.id })) },
  { provider: "mistral", url: "https://api.mistral.ai/v1/models", env: "MISTRAL_API_KEY", auth: (k) => ({ Authorization: `Bearer ${k}` }),
    parse: (j) => (j.data ?? []).map((m: any) => ({ provider: "mistral", id: m.id, vision: !!m.capabilities?.vision, shutdown_date: m.deprecation ?? null })) },
];

// Which tasks a newly listed id should be queued for. Conservative: small/cheap families only for the
// high-volume vision tasks; anything else is queued under long_reasoning for a human to sort.
export function tasksFor(l: Listed): string[] {
  const id = l.id.toLowerCase();
  if (/(embed|tts|whisper|transcribe|realtime|image-|imagen|veo|audio|moderation|search|computer-use)/.test(id)) return [];
  if (/ocr/.test(id)) return ["document_ocr"];
  if (/(mini|nano|lite|haiku|luna|flash|fast)/.test(id)) return ["photo_classify", "document_ocr", "sensitive_document", "listing_extract"];
  return ["long_reasoning"];
}

export async function watch(deps: {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  known: () => Promise<Array<{ provider: string; model: string; version: string | null; id: string }>>;
  setDates: (rowId: string, deprecated: string | null, shutdown: string | null) => Promise<void>;
  env: (k: string) => string | undefined;
  fetchImpl?: typeof fetch;
}) {
  const f = deps.fetchImpl ?? fetch;
  const known = await deps.known();
  const isKnown = (p: string, id: string) => known.some((k) => k.provider === p && (k.model === id || k.version === id));
  const digest = { new_candidates: [] as string[], shutdowns: [] as string[], errors: [] as string[] };
  for (const s of SOURCES) {
    const key = deps.env(s.env);
    if (!key) { digest.errors.push(`${s.provider}: no key`); continue; }
    let listed: Listed[] = [];
    try {
      const r = await f(s.url, { headers: s.auth(key) });
      if (!r.ok) { digest.errors.push(`${s.provider}: HTTP ${r.status}`); continue; }
      listed = s.parse(await r.json());
    } catch (e) { digest.errors.push(`${s.provider}: ${(e as Error).message}`); continue; }
    for (const l of listed) {
      for (const k of known.filter((k) => k.provider === l.provider && (k.model === l.id || k.version === l.id))) {
        if (l.shutdown_date) { await deps.setDates(k.id, null, l.shutdown_date); digest.shutdowns.push(`${l.provider}/${l.id} shuts down ${l.shutdown_date}`); }
      }
      if (isKnown(l.provider, l.id)) continue;
      for (const task of tasksFor(l)) {
        // Price is unknown from list endpoints; a human (or the pricing-page check) fills it before approval.
        await deps.rpc("model_queue_candidate", { p_task: task, p_provider: l.provider, p_model: l.id, p_version: null,
          p_price_in: null, p_price_out: null, p_price_url: null, p_notes: `listed by ${l.provider} ${l.created ?? ""}`.trim() });
        digest.new_candidates.push(`${task}: ${l.provider}/${l.id}`);
      }
    }
  }
  // Known models that a provider silently dropped from its list are reported, not retired.
  await deps.rpc("model_retire_expired", {});
  return digest;
}
