import { RETAINED_PROPERTY_MODES } from "./retainedInterior.ts";

export const RETAINED_LISTING_DRAIN_MODE = "retained_listing_property_drain_v1";
export const RETAINED_LISTING_DRAIN_LIMIT = 120;
const ADMISSION_CONCURRENCY = 2;
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
  "9fc93dd3-3639-439a-8eed-3e9a0f846334": "vin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

/** Successful, qualified DB inputs live only for one bounded service drain.
 * Admission and completion still prove current custody in Postgres. */
export class RetainedBatchLookups {
  private rows = new Map<string, any>();
  private inFlight = new Map<string, Promise<any>>();
  private bytes = 0;
  private counts = { reads_started: 0, cache_hits: 0, in_flight_shares: 0 };
  get(key: string): any { return this.rows.get(key); }
  /** Share only reads within this drain. Qualification still decides what may
   * be retained; failed/missing/unqualified results never become cache entries.
   * The original SDK request keeps its cancellation and five-second deadline. */
  async read(key: string, load: () => PromiseLike<any>): Promise<any> {
    const cached = this.get(key);
    if (cached !== undefined) { this.counts.cache_hits++;return cached; }
    const pending = this.inFlight.get(key);
    if (pending) { this.counts.in_flight_shares++;return pending; }
    this.counts.reads_started++;
    const task = Promise.resolve().then(load);
    this.inFlight.set(key, task);
    try { return await task; }
    finally { this.inFlight.delete(key); }
  }
  stats() { return { ...this.counts }; }
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
    retries: 0, deferred: 0, completion_failures: 0, model_calls: 0, provider_calls: 0,
    // Counts describe failed operations, not unique items or a historical root
    // cause. A failed done CAS and its failed retry can both be represented.
    failure_stages: { admission_http: 0, admission_receipt: 0, admission_exception: 0,
      completion_rpc: 0, completion_custody: 0, completion_exception: 0,
      completion_budget: 0, completion_retry: 0 },
    admission_http_statuses: {} as Record<string, number> };
  const process = async (row: any) => {
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
        else if (!response.ok) {
          summary.failure_stages.admission_http++;
          const code = String(response.status);
          summary.admission_http_statuses[code] = (summary.admission_http_statuses[code] ?? 0) + 1;
        } else summary.failure_stages.admission_receipt++;
      } catch { status = "retry";summary.failure_stages.admission_exception++; }
    }
    if (Date.now() - started >= 55000) {
      summary.completion_failures++;summary.failure_stages.completion_budget++;return;
    }
    try {
      let finished = await call("finish_retained_listing_property", { p_source: row.source_observation_id,
        p_property: row.property_id, p_worker: worker, p_status: status, p_result: result });
      if (finished.error || finished.data !== true) {
        summary.completion_failures++;
        if (finished.error) summary.failure_stages.completion_rpc++;
        else summary.failure_stages.completion_custody++;
        // A successful HTTP acknowledgement is not persisted custody proof.
        // If its lease remains ours, retry instead of falsely marking done.
        if (status === "done" && Date.now() - started < 50000) {
          finished = await call("finish_retained_listing_property", { p_source: row.source_observation_id,
            p_property: row.property_id, p_worker: worker, p_status: "retry", p_result: null });
          if (!finished.error && finished.data === true) summary.retries++;
          else summary.failure_stages.completion_retry++;
        }
        return;
      }
      if (status === "done") { summary.stored++;if (duplicate) summary.duplicates++;else summary.writes++; }
      else if (status === "refused") summary.refused++;
      else if (status === "deferred") summary.deferred++;
      else summary.retries++;
    } catch { summary.completion_failures++;summary.failure_stages.completion_exception++; }
  };
  // Overlap at most two source admissions within the existing per-drain
  // attempt and time budgets. Every result still requires its own custody CAS.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(ADMISSION_CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) await process(rows[next++]);
  }));
  return json({ success: summary.completion_failures === 0, mode: RETAINED_LISTING_DRAIN_MODE,
    ...summary, input_lookups: lookups.stats(), duration_ms: Date.now() - started });
}
