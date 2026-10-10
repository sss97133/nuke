import { RETAINED_PROPERTY_MODES } from "./retainedInterior.ts";

export const RETAINED_LISTING_DRAIN_MODE = "retained_listing_property_drain_v1";
export const RETAINED_LISTING_DRAIN_LIMIT = 120;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PROPERTY_KEYS: Record<string, string> = {
  "514cacd3-82b4-4330-b3df-e292612ee718": "interior_color",
  "efcb8c61-1ff5-4790-890e-2e09118e87e3": "exterior_color",
  "c0f743ae-dc94-4dfd-98ef-514b76f74a9b": "engine_configuration",
  "66b2f1f6-b714-4ac0-85b6-60ba89529c1a": "engine_displacement_l",
  "235aed17-9bd3-4886-90be-9b1a8e2d1844": "transmission_type",
  "32b51f19-e5cf-4f67-81d9-96c2d30885a1": "drivetrain_layout",
  "abdd7a7a-02c1-4b09-afc6-1a288207dd2d": "mileage_miles",
  "ece619f7-c49a-44f7-999f-a41acf5d4dc3": "year",
  "8d274b73-a8a6-43bf-9036-5864d0152725": "make",
  "a79b528f-7d9d-46ca-96f9-96d899e81d10": "model",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

/** Successful, qualified DB inputs live only for one bounded service drain.
 * Admission and completion still prove current custody in Postgres. */
export class RetainedBatchLookups {
  private rows = new Map<string, any>();
  private bytes = 0;
  get(key: string): any { return this.rows.get(key); }
  remember(key: string, result: any): void {
    if (result?.error || !result?.data || this.rows.has(key) || this.rows.size >= 256) return;
    const size = new TextEncoder().encode(JSON.stringify(result.data)).length;
    if (this.bytes + size > 4 * 1024 * 1024) return;
    this.rows.set(key, result); this.bytes += size;
  }
}

/** Service-authorized scheduled work enters the existing selector handler in
 * process. No caller-supplied testimony and no nested Edge request per item. */
export async function drainRetainedListingProperties(
  req: Request, input: Record<string, unknown>, db: any,
  admit: (request: Request, lookups?: RetainedBatchLookups) => Promise<Response>,
): Promise<Response> {
  const limit = input.batch_size;
  if (input.mode !== RETAINED_LISTING_DRAIN_MODE ||
    Object.keys(input).some(k => !["mode", "batch_size"].includes(k)) ||
    !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > RETAINED_LISTING_DRAIN_LIMIT) {
    return json({ success: false, error: "invalid_bounded_listing_drain", writes: 0, model_calls: 0 }, 400);
  }
  const started = Date.now(), worker = `retained-listing:${crypto.randomUUID()}`;
  const call = (name: string, args: Record<string, unknown>) => db.rpc(name, args)
    .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(5000, 55000 - (Date.now() - started)))));
  const claimed = await call("claim_retained_listing_properties", { p_worker: worker, p_limit: limit });
  if (claimed.error || !Array.isArray(claimed.data)) {
    return json({ success: false, error: "listing_work_unavailable", writes: 0, model_calls: 0 }, 503);
  }
  const rows = claimed.data, keys = new Set();
  if (rows.length > Number(limit) || rows.some((row: any) => {
    const property = PROPERTY_KEYS[row?.property_id];
    const expected = property ? `retained_listing_${property}_v1` : null;
    const key = `${row?.source_observation_id}:${row?.property_id}`;
    if (!UUID.test(row?.source_observation_id ?? "") || expected === null || row.mode !== expected ||
      !RETAINED_PROPERTY_MODES.includes(row.mode) || keys.has(key)) return true;
    keys.add(key);return false;
  })) return json({ success: false, error: "invalid_claimed_listing_work", writes: 0, model_calls: 0 }, 503);
  const lookups = new RetainedBatchLookups();
  const summary = { claimed: rows.length, stored: 0, writes: 0, duplicates: 0, refused: 0,
    retries: 0, deferred: 0, completion_failures: 0, model_calls: 0, provider_calls: 0 };
  for (const row of rows) {
    let status = "deferred", result: string | null = null, duplicate = false;
    if (!req.signal.aborted && Date.now() - started < 35000) {
      status = "retry";
      try {
        const response = await admit(new Request(req.url, { method: "POST", headers: req.headers,
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(40000 - (Date.now() - started))]),
          body: JSON.stringify({ mode: row.mode, source_observation_id: row.source_observation_id }) }), lookups);
        const body = await response.json();
        if (response.status === 200 && body.success === true && UUID.test(body.observation_id ?? "") &&
          typeof body.duplicate === "boolean") {
          status = "done";result = body.observation_id;duplicate = body.duplicate;
        } else if (response.status === 400 && body.error === "Retained source ineligible") status = "refused";
      } catch { status = "retry"; }
    }
    if (Date.now() - started >= 55000) { summary.completion_failures++;continue; }
    try {
      let finished = await call("finish_retained_listing_property", { p_source: row.source_observation_id,
        p_property: row.property_id, p_worker: worker, p_status: status, p_result: result });
      if (finished.error || finished.data !== true) {
        summary.completion_failures++;
        // A successful HTTP acknowledgement is not persisted custody proof.
        // If its lease remains ours, retry instead of falsely marking done.
        if (status === "done" && Date.now() - started < 50000) {
          finished = await call("finish_retained_listing_property", { p_source: row.source_observation_id,
            p_property: row.property_id, p_worker: worker, p_status: "retry", p_result: null });
          if (!finished.error && finished.data === true) summary.retries++;
        }
        continue;
      }
      if (status === "done") { summary.stored++;if (duplicate) summary.duplicates++;else summary.writes++; }
      else if (status === "refused") summary.refused++;
      else if (status === "deferred") summary.deferred++;
      else summary.retries++;
    } catch { summary.completion_failures++; }
  }
  return json({ success: summary.completion_failures === 0, mode: RETAINED_LISTING_DRAIN_MODE,
    ...summary, duration_ms: Date.now() - started });
}
