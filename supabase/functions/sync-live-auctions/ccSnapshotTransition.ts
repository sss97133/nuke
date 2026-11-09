/** Canonical admitted state is the cursor, including admissions whose projection failed. */
import type { ObservationPost } from "./boards.ts";
export const CC_SNAPSHOT_V2 = "cc_typesense_board_snapshot_v2";
export const validCcSnapshotOwner = (p: ObservationPost) =>
  typeof p.vehicle_id === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.vehicle_id)
  && typeof p.source_url === "string" && /^https:\/\/collectingcars\.com\/for-sale\/[a-zA-Z0-9+-]+$/.test(p.source_url);
const stateKeys = ["amount", "currency", "bid_count", "auction_id", "ends", "clock"];
const equal = (a: any, b: any) => stateKeys.every(k => k === "ends"
  ? (a?.[k] == null && b?.[k] == null) || Date.parse(a?.[k]) === Date.parse(b?.[k])
  : a?.[k] === b?.[k]);
export function chooseCcTransition(p: ObservationPost, rows: any[]): ObservationPost {
  if (rows.length > 2 || rows.some(o => o.vehicle_id !== p.vehicle_id || o.source_url !== p.source_url
    || !["cc_typesense_board_bid_v1", CC_SNAPSHOT_V2].includes(o.extraction_method)
    || !Number.isFinite(Date.parse(o.observed_at)))) throw Error("CC prior canonical owner refused");
  const sorted = [...rows].sort((a,b) => Date.parse(b.observed_at)-Date.parse(a.observed_at) || a.id.localeCompare(b.id));
  const prior = sorted[0];
  if (sorted[1] && Date.parse(prior.observed_at) === Date.parse(sorted[1].observed_at)
    ) throw Error("CC prior canonical clock is ambiguous");
  const incoming = Date.parse(p.observed_at), previous = Date.parse(prior?.observed_at);
  if (!Number.isFinite(incoming) || (prior && incoming < previous)) throw Error("CC current read is older than canonical state");
  if (prior?.extraction_method === CC_SNAPSHOT_V2 && equal(prior.structured_data, p.structured_data))
    return { ...p, source_identifier: prior.source_identifier, structured_data: { ...p.structured_data,
      previous_observation_id: prior.structured_data?.previous_observation_id ?? null } };
  if (prior && incoming <= previous) throw Error("CC transition needs a newer native read");
  // No read clock in identity. Concurrent same transition shares the same idempotency key.
  return { ...p, source_identifier: `${p.source_identifier}:after:${prior?.id ?? "origin"}`,
    structured_data: { ...p.structured_data, previous_observation_id: prior?.id ?? null } };
}
async function latest(db: any, posts: ObservationPost[], deadline: number): Promise<any[]> {
  if (!posts.length) return [];
  if (posts.length > 200 || posts.some(p => !validCcSnapshotOwner(p)) || Date.now() >= deadline) throw Error("CC transition read budget");
  const r = await db.rpc("cc_latest_snapshot_states", { p_lots: posts.map(p => ({ vehicle_id: p.vehicle_id, source_url: p.source_url })) })
    .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(5000, deadline-Date.now()))));
  if (r.error || !Array.isArray(r.data) || r.data.length > posts.length*2) throw Error("CC prior canonical state unavailable");
  return r.data;
}
export async function planCcTransitions(db: any, posts: ObservationPost[], deadline: number) {
  const out = { posts: [] as ObservationPost[], deferred: 0, errors: [] as string[] };
  const eligible = posts.filter(p => {
    if (validCcSnapshotOwner(p)) return true;
    out.deferred++; out.errors.push("CC invalid native lot owner deferred before canonical lookup"); return false;
  });
  for (let i=0;i<eligible.length;i+=200) {
    const batch=eligible.slice(i,i+200);
    try {
      const rows=await latest(db,batch,deadline);
      for (const p of batch) {
        try { out.posts.push(chooseCcTransition(p,rows.filter(o=>o.vehicle_id===p.vehicle_id && o.source_url===p.source_url))); }
        catch(e) { out.deferred++; out.errors.push(String(e).slice(0,150)); }
      }
    } catch(e) { out.deferred+=eligible.length-i; out.errors.push(String(e).slice(0,150)); break; }
  }
  return out;
}
export async function refreshCcTransition(db: any, original: ObservationPost, planned: ObservationPost, deadline: number): Promise<boolean> {
  const rows=await latest(db,[original],deadline), current=chooseCcTransition(original,rows);
  if(current.source_identifier!==planned.source_identifier) throw Error("CC canonical state advanced during capture; retry");
  return !rows.some(o=>o.source_identifier===planned.source_identifier); // another worker already admitted it
}
