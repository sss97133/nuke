import { BAT_LIVE_MODE, batUrl, prepareBatLiveFrame, type BatLiveTarget } from "../_shared/batLiveEvents.ts";

/** Extend the canonical intake; collectors cannot write logs or auction projections. */
export async function ingestBatLive(db: any, body: any) {
  if (Object.keys(body).some(k => !["mode", "frames", "heartbeats"].includes(k)) || body.mode !== BAT_LIVE_MODE
    || !Array.isArray(body.frames) || body.frames.length > 50 || !Array.isArray(body.heartbeats)
    || body.heartbeats.length > 200 || (!body.frames.length && !body.heartbeats.length)) throw new Error("invalid_bat_live_batch");
  const ids = [...new Set([...body.frames.map((f: any) => f.monitored_auction_id), ...body.heartbeats.map((h: any) => h.monitored_auction_id)])];
  if (ids.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) throw new Error("invalid_monitor_locator");
  const { data: monitors, error } = await db.from("monitored_auctions")
    .select("id,source_id,vehicle_id,external_auction_url,stream_state").in("id", ids);
  if (error || monitors?.length !== ids.length) throw new Error("bat_monitor_unavailable");
  const source = await db.from("live_auction_sources").select("id").eq("slug", "bat").single();
  const parents = await db.from("vehicles").select("id,listing_url,origin_metadata")
    .in("id", monitors.map((m: any) => m.vehicle_id)).is("deleted_at", null);
  if (source.error || parents.error) throw new Error("bat_parent_unavailable");
  const targets = new Map<string, BatLiveTarget>();
  for (const m of monitors) {
    const v = parents.data?.find((v: any) => v.id === m.vehicle_id);
    const postId = Number(v?.origin_metadata?.external_id);
    if (m.source_id !== source.data.id || !v || v.origin_metadata?.source !== "bat_auctions_page"
      || !Number.isSafeInteger(postId) || postId <= 0 || batUrl(v.listing_url) !== batUrl(m.external_auction_url)) {
      throw new Error("bat_source_binding_unavailable");
    }
    targets.set(m.id, { id: m.id, vehicle_id: m.vehicle_id, post_id: postId,
      source_url: batUrl(m.external_auction_url), last_comment_id: Number(m.stream_state?.last_comment_id || 0) });
  }
  const frames = await Promise.all(body.frames.map((f: any) => prepareBatLiveFrame(f, targets.get(f.monitored_auction_id)!)));
  for (const h of body.heartbeats) {
    if (Object.keys(h).some(k => !["monitored_auction_id", "session_id", "at", "connected", "pending", "oldest_received_at", "error"].includes(k))
      || !/^[0-9a-f-]{36}$/i.test(h.session_id || "") || !Number.isFinite(Date.parse(h.at))
      || typeof h.connected !== "boolean" || !Number.isSafeInteger(h.pending) || h.pending < 0
      || (h.oldest_received_at !== null && !Number.isFinite(Date.parse(h.oldest_received_at)))
      || (h.error !== null && (typeof h.error !== "string" || h.error.length > 500))) throw new Error("invalid_bat_stream_heartbeat");
  }
  const result = await db.rpc("ingest_bat_live_events", { p_frames: frames, p_heartbeats: body.heartbeats });
  if (result.error) throw new Error(`bat_live_admission_failed:${result.error.message}`);
  return { success: true, ...result.data };
}
