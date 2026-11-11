import { collectingCarsReplayCandidates, replayClosedCollectingCars, type CcSnapshotPin } from "../extract-collecting-cars/historicalReplay.ts";
import { collectingCarsOwner } from "../ingest/collectingCars.ts";

type Selection = { mode: "fresh"; reason: string } | { mode: "pinned"; pin: CcSnapshotPin; sourceReadAt: string }
  | { mode: "deferred" | "failed"; reason: string };

/** Read-only selection. The supplied client must bind ALL fetches, including protected Storage, to signal. */
export async function selectCollectingCarsReplay(db: any, url: string, identity: { auctionId: number; stage: string | null } | undefined,
  capability: boolean, signal: AbortSignal): Promise<Selection> {
  try {
    signal.throwIfAborted();
    if (!identity || !Number.isSafeInteger(identity.auctionId) || identity.auctionId <= 0) return { mode: "failed", reason: "cc_replay_index_identity_missing" };
    if (["live", "upcoming", "comingsoon"].includes(identity.stage ?? "")) return { mode: "fresh", reason: "current_index_open" };
    if (!["sold", "unsold"].includes(identity.stage ?? "")) return { mode: "failed", reason: "cc_replay_index_stage_unknown" };
    const read = await db.from("vehicles").select("id,listing_url,vin,year,make,status,deleted_at,merged_into_vehicle_id,origin_metadata")
      .eq("listing_url", url).limit(2).abortSignal(signal);
    if (read.error || !Array.isArray(read.data)) return { mode: "deferred", reason: "cc_replay_owner_unavailable" };
    if (!read.data.length) return { mode: "fresh", reason: "no_existing_url_owner" };
    if (read.data.length !== 1 || !read.data[0].id || read.data[0].listing_url !== url || read.data[0].deleted_at
      || read.data[0].status === "merged" || read.data[0].merged_into_vehicle_id
      || (read.data[0].origin_metadata?.auction_id != null && String(read.data[0].origin_metadata.auction_id) !== String(identity.auctionId)))
      return { mode: "failed", reason: "cc_replay_owner_conflict" };
    const candidates = await collectingCarsReplayCandidates(db, url);
    if (!candidates.length) return { mode: "fresh", reason: "no_retained_candidate" };
    if (!capability) return { mode: "deferred", reason: "cc_replay_capability_unavailable" };
    for (const candidate of candidates) {
      signal.throwIfAborted();
      try {
        const pin = { snapshot_id: candidate.snapshot_id, expected_sha256: candidate.expected_sha256 };
        const replay = await replayClosedCollectingCars(db, url, pin, String(identity.auctionId));
        signal.throwIfAborted();
        if (collectingCarsOwner(read.data, replay.extracted) !== read.data[0].id) return { mode: "failed", reason: "cc_replay_owner_conflict" };
        return { mode: "pinned", pin, sourceReadAt: replay.source_capture.observed_at };
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof Error && error.message === "cc_snapshot_open_car") continue;
        throw error;
      }
    }
    return { mode: "fresh", reason: "only_verified_open_candidates" };
  } catch (error) {
    if (signal.aborted || (error instanceof Error && /unavailable|AbortError|TimeoutError/.test(error.message)))
      return { mode: "deferred", reason: "cc_replay_preflight_unavailable" };
    return { mode: "failed", reason: error instanceof Error ? error.message.slice(0, 160) : "cc_replay_preflight_failed" };
  }
}
