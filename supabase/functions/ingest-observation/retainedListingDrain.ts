import { RETAINED_EXTERIOR_MODE, RETAINED_INTERIOR_MODE } from "./retainedInterior.ts";

export const RETAINED_LISTING_DRAIN_MODE = "retained_listing_property_drain_v1";
export const RETAINED_LISTING_DRAIN_LIMIT = 120;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const INTERIOR = "514cacd3-82b4-4330-b3df-e292612ee718";
const EXTERIOR = "efcb8c61-1ff5-4790-890e-2e09118e87e3";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});

/** Service-authorized scheduled work enters the existing selector handler in
 * process. No caller-supplied testimony and no nested Edge request per item. */
export async function drainRetainedListingProperties(
  req: Request, input: Record<string, unknown>, db: any,
  admit: (request: Request) => Promise<Response>,
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
    const expected = row?.property_id === INTERIOR ? RETAINED_INTERIOR_MODE
      : row?.property_id === EXTERIOR ? RETAINED_EXTERIOR_MODE : null;
    const key = `${row?.source_observation_id}:${row?.property_id}`;
    if (!UUID.test(row?.source_observation_id ?? "") || expected === null || row.mode !== expected || keys.has(key)) return true;
    keys.add(key);return false;
  })) return json({ success: false, error: "invalid_claimed_listing_work", writes: 0, model_calls: 0 }, 503);
  const summary = { claimed: rows.length, stored: 0, writes: 0, duplicates: 0, refused: 0,
    retries: 0, deferred: 0, completion_failures: 0, model_calls: 0, provider_calls: 0 };
  for (const row of rows) {
    let status = "deferred", result: string | null = null, duplicate = false;
    if (!req.signal.aborted && Date.now() - started < 35000) {
      status = "retry";
      try {
        const response = await admit(new Request(req.url, { method: "POST", headers: req.headers,
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(40000 - (Date.now() - started))]),
          body: JSON.stringify({ mode: row.mode, source_observation_id: row.source_observation_id }) }));
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
