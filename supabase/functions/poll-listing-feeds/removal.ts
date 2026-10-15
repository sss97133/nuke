/**
 * What a classified's death looks like, and what the poller writes when it sees one.
 *
 * A Craigslist post that is deleted, flagged, expired or sold off-site answers HTTP 404 (posts from 2025 do; 2026-10-15).
 * That is the only evidence taken. A post that merely scrolled off the first page of a search is NOT removed: only the
 * first page is read. So the sweep asks the post itself, one request per 2 s, a few per invocation, oldest check first.
 *
 *   404 or 410   the listing is `ended`: event_status 'ended', ended_at = the fetch time, metadata.removal = the evidence.
 *                Outcome unknown (withdrawn, expired or sold elsewhere); never a sale. The listing observations stay.
 *   200          still live: metadata.last_checked_at is stamped so the post goes to the back of the line.
 *   anything else (403, 429, 5xx, network): stop the sweep, write nothing. A block is not a removal.
 */
import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";

export type Probe = { status: number | null; observed_at: string; snapshot_id: string | null };
export type SweepOutcome = "ended" | "live" | "stopped" | "error";

export function classifyProbe(status: number | null): "ended" | "live" | "blocked" {
  if (status === 404 || status === 410) return "ended";
  if (status !== null && status >= 200 && status < 300) return "live";
  return "blocked";
}

/** The event row patch for a listing seen dead. ended_at is fill-only in the writer; an existing close stays. */
export function endedRow(live: { vehicle_id: string; source_listing_id: string; source_url: string }, probe: Probe) {
  return {
    vehicle_id: live.vehicle_id,
    source_platform: "craigslist",
    source_listing_id: live.source_listing_id,
    source_url: live.source_url,
    event_type: "listing",
    event_status: "ended",
    ended_at: probe.observed_at,
    updated_at: probe.observed_at,
    metadata: {
      source_observed_at: probe.observed_at,
      last_checked_at: probe.observed_at,
      removal: { http_status: probe.status, observed_at: probe.observed_at, basis: "revisit", ...(probe.snapshot_id ? { snapshot_id: probe.snapshot_id } : {}) },
    },
  };
}

export interface SweepDeps {
  supabase: any;
  probe: (url: string) => Promise<Probe>;
  /** Milliseconds left in this invocation. */
  remainingMs: () => number;
  sleep: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** Check up to `max` landed Craigslist listings that are still `unknown`, oldest check first. Never throws. */
export async function sweepCraigslistRemovals(deps: SweepDeps, max = 5, minAgeMs = 24 * 3600_000, spacingMs = 2000) {
  const out = { checked: 0, ended: 0, live: 0, stopped: null as string | null, errors: [] as string[] };
  try {
    const before = new Date((deps.now?.() ?? new Date()).getTime() - minAgeMs).toISOString();
    const { data, error } = await deps.supabase.from("vehicle_events")
      .select("id, vehicle_id, source_listing_id, source_url, metadata")
      .eq("source_platform", "craigslist").eq("event_status", "unknown").lt("updated_at", before)
      .not("source_url", "is", null).not("source_listing_id", "is", null)
      .order("updated_at", { ascending: true }).limit(max);
    if (error) { out.errors.push(error.message); return out; }
    for (const row of data ?? []) {
      if (deps.remainingMs() < 20_000) { out.stopped = "worker_deadline"; break; }
      const probe = await deps.probe(row.source_url);
      out.checked++;
      const verdict = classifyProbe(probe.status);
      if (verdict === "blocked") { out.stopped = `http_${probe.status ?? "none"}`; break; }
      const base = { vehicle_id: row.vehicle_id, source_listing_id: row.source_listing_id, source_url: row.source_url };
      const result = verdict === "ended"
        ? await writeVehicleEventByKey(deps.supabase, endedRow(base, probe), { sourceObservedAt: probe.observed_at })
        : await writeVehicleEventByKey(deps.supabase, {
          ...base, source_platform: "craigslist", updated_at: probe.observed_at, metadata: { last_checked_at: probe.observed_at, source_observed_at: probe.observed_at },
        }, { preserveEventStatus: true, sourceObservedAt: probe.observed_at });
      if (result.action === "error") out.errors.push(result.error);
      else if (verdict === "ended") out.ended++; else out.live++;
      await deps.sleep(spacingMs);
    }
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : String(e));
  }
  return out;
}
