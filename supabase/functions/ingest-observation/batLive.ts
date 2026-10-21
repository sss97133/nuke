import { BAT_LIVE_MODE, batUrl, prepareBatLiveFrame, type BatLiveTarget, BatLiveAdmissionError } from "../_shared/batLiveEvents.ts";

export interface BatLiveDiagnostics {
  trace: boolean;
  transport?: "canonical_in_process" | "edge_http";
  collectorRunId?: string;
  sequence?: number;
  authMs?: number;
  sdkFetches?: number;
  sdkRuntimeLimits?: number;
  sdkFetchMs?: number;
}

// Data/constraint refusals can isolate a lot. Network, cancellation, locking,
// configuration and unknown availability failures retain the whole atomic batch.
function databaseFailure(error: any, message: string) {
  return new BatLiveAdmissionError(/^(22|23)|^P0001$/.test(String(error?.code ?? "")) ? "semantic" : "transient", message);
}

/** Extend the canonical intake; collectors cannot write logs or auction projections. */
export async function ingestBatLive(db: any, body: any, diagnostics?: BatLiveDiagnostics, expectedBindings?: ReadonlyMap<string, BatLiveTarget>) {
  const started = performance.now(), requestAt = new Date().toISOString();
  const timings: Record<string, number> = {};
  let stage = "validation", outcome = "failed";
  const measured = async (name: string, run: () => PromiseLike<any>) => {
    stage = name;
    const at = performance.now();
    try { return await run(); }
    finally { timings[name] = Math.round((performance.now() - at) * 100) / 100; }
  };
  try {
    if (Object.keys(body).some(k => !["mode", "frames", "heartbeats"].includes(k)) || body.mode !== BAT_LIVE_MODE
      || !Array.isArray(body.frames) || body.frames.length > 50 || !Array.isArray(body.heartbeats)
      || body.heartbeats.length > 200 || (!body.frames.length && !body.heartbeats.length)) throw new Error("invalid_bat_live_batch");
    const ids = [...new Set([...body.frames.map((f: any) => f.monitored_auction_id), ...body.heartbeats.map((h: any) => h.monitored_auction_id)])];
    if (ids.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) throw new Error("invalid_monitor_locator");
    const { data: monitors, error } = await measured("monitors", () => db.from("monitored_auctions")
      .select("id,source_id,vehicle_id,external_auction_url,stream_state").in("id", ids));
    if (error) throw databaseFailure(error, "bat_monitor_unavailable");
    if (monitors?.length !== ids.length) throw new Error("bat_monitor_unavailable");
    const source = await measured("source", () => db.from("live_auction_sources").select("id").eq("slug", "bat").single());
    const parents = await measured("parents", () => db.from("vehicles").select("id,listing_url,origin_metadata")
      .in("id", monitors.map((m: any) => m.vehicle_id)).is("deleted_at", null));
    if (source.error || parents.error) throw databaseFailure(source.error || parents.error, "bat_parent_unavailable");
    const targets = new Map<string, BatLiveTarget>();
    stage = "binding";
    for (const m of monitors) {
      const v = parents.data?.find((v: any) => v.id === m.vehicle_id);
      const postId = Number(v?.origin_metadata?.external_id);
      if (m.source_id !== source.data.id || !v || v.origin_metadata?.source !== "bat_auctions_page"
        || !Number.isSafeInteger(postId) || postId <= 0 || batUrl(v.listing_url) !== batUrl(m.external_auction_url)) {
        throw new Error("bat_source_binding_unavailable");
      }
      const current = { id: m.id, vehicle_id: m.vehicle_id, post_id: postId,
        source_url: batUrl(m.external_auction_url), last_comment_id: Number(m.stream_state?.last_comment_id || 0) };
      // A socket's selected identity is a rejection fence, never authority to skip
      // the fresh reads above. A changed post must not validate an old channel's
      // coverage heartbeat merely because the replacement post is also numeric.
      const selected = expectedBindings?.get(m.id);
      if (expectedBindings && (!selected || selected.vehicle_id !== current.vehicle_id
        || selected.post_id !== current.post_id || selected.source_url !== current.source_url))
        throw new Error("bat_source_binding_changed");
      targets.set(m.id, current);
    }
    const frames = await measured("preparation", () => Promise.all(body.frames.map((f: any) => prepareBatLiveFrame(f, targets.get(f.monitored_auction_id)!))));
    stage = "heartbeat_validation";
    for (const h of body.heartbeats) {
      if (Object.keys(h).some(k => !["monitored_auction_id", "session_id", "at", "connected", "pending", "oldest_received_at", "error"].includes(k))
        || !/^[0-9a-f-]{36}$/i.test(h.session_id || "") || !Number.isFinite(Date.parse(h.at))
        || typeof h.connected !== "boolean" || !Number.isSafeInteger(h.pending) || h.pending < 0
        || (h.oldest_received_at !== null && !Number.isFinite(Date.parse(h.oldest_received_at)))
        || (h.error !== null && (typeof h.error !== "string" || h.error.length > 500))) throw new Error("invalid_bat_stream_heartbeat");
    }
    const result = await measured("canonical_rpc", () => db.rpc("ingest_bat_live_events", { p_frames: frames, p_heartbeats: body.heartbeats }));
    if (result.error) throw databaseFailure(result.error, `bat_live_admission_failed:${result.error.message}`);
    const output = { success: true, ...result.data };
    outcome = output.success === true ? "success_returned" : "non_success_returned";
    return output;
  } finally {
    if (diagnostics?.trace) console.info(JSON.stringify({ event: "bat_native_intake_timing_v1",
      collector_run_id: diagnostics.collectorRunId, sequence: diagnostics.sequence,
      admission_transport: diagnostics.transport ?? "edge_http",
      at: requestAt, auth_ms: diagnostics.authMs, frames: Array.isArray(body?.frames) ? body.frames.length : null,
      heartbeats: Array.isArray(body?.heartbeats) ? body.heartbeats.length : null,
      outcome, last_stage: stage, stages_ms: timings,
      native_sdk_fetches: diagnostics.sdkFetches ?? 0, native_sdk_runtime_limits: diagnostics.sdkRuntimeLimits ?? 0,
      native_sdk_fetch_ms: Math.round((diagnostics.sdkFetchMs ?? 0) * 100) / 100,
      native_ms: Math.round((performance.now() - started) * 100) / 100 }));
  }
}
