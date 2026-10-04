import { BAT_LIVE_MODE, BAT_PUBLIC_SOCKET, BatLiveBuffer, batUrl, type BatLiveFrame, type BatLiveTarget } from "../_shared/batLiveEvents.ts";

/** Existing minute cron hands off overlapping 115-second workers. A connection
 * multiplexes EVERY eligible closing lot; p_lots never caps live subscriptions.
 * No HTML polling, model calls, private channels, cookies or source writes.
 */
export async function closingBatTargets(db: any): Promise<BatLiveTarget[]> {
  const source = await db.from("live_auction_sources").select("id").eq("slug", "bat").single();
  if (source.error) throw new Error("bat_source_unavailable");
  const monitors = await db.from("monitored_auctions")
    .select("id,vehicle_id,external_auction_url,stream_state")
    .eq("source_id", source.data.id)
    .or(`is_live.eq.true,stream_state->>terminal_received_at.gte.${new Date(Date.now() - 120000).toISOString()}`)
    .lte("auction_end_time", new Date(Date.now() + 15 * 60000).toISOString()).limit(201);
  if (monitors.error || monitors.data.length > 200) throw new Error("bat_closing_coverage_unavailable_or_over_capacity");
  if (!monitors.data.length) return [];
  const parents = await db.from("vehicles").select("id,listing_url,origin_metadata")
    .in("id", monitors.data.map((m: any) => m.vehicle_id)).is("deleted_at", null);
  if (parents.error) throw new Error("bat_closing_parent_unavailable");
  return monitors.data.flatMap((m: any) => {
    const v = parents.data.find((v: any) => v.id === m.vehicle_id);
    const post = Number(v?.origin_metadata?.external_id);
    try {
      if (!v || v.origin_metadata?.source !== "bat_auctions_page" || !Number.isSafeInteger(post) || post <= 0
        || batUrl(v.listing_url) !== batUrl(m.external_auction_url)) throw new Error("binding_missing");
      return [{ id: m.id, vehicle_id: m.vehicle_id, source_url: batUrl(m.external_auction_url),
        post_id: post, last_comment_id: Number(m.stream_state?.last_comment_id || 0) }];
    } catch {
      // A bad locator cannot take every good lot offline. The coverage assay
      // includes this monitor and fails because it receives no heartbeat.
      console.error(`bat_closing_binding_missing:${m.id}`);
      return [];
    }
  });
}

export interface BatStreamIO {
  admit(frames: BatLiveFrame[], heartbeats: unknown[]): Promise<void>;
  missed(target: BatLiveTarget): Promise<any>;
  socket?: (url: string) => WebSocket;
}

export async function collectBatLive(targets: BatLiveTarget[], io: BatStreamIO, durationMs = 115000) {
  if (!targets.length) return;
  const sessionId = crypto.randomUUID();
  const channels = new Map<string, BatLiveTarget>();
  const acknowledged = new Set<string>();
  for (const target of targets) for (const type of ["single", "stats", "list"]) channels.set(`post;${type};${target.post_id}`, target);
  const recovery = new Set<string>();
  const recoveryErrors = new Map<string,string>();
  const tasks = new Set<Promise<void>>();
  let stopped = false, socket: WebSocket | null = null, lastServerAt = 0, lastPingAt = 0;
  let lastHeartbeatAt = 0, lastRecoveryAt = 0, lastError: string | null = null;
  let reconnectAt = 0;
  const buffer = new BatLiveBuffer(async frames => {
    await io.admit(frames, []);
    for (const f of frames) {
      const target = targets.find(t => t.id === f.monitored_auction_id)!;
      if (f.event === "comment-added") target.last_comment_id = Math.max(target.last_comment_id, Number(f.data.comment?.id || 0));
    }
  });
  const enqueue = (target: BatLiveTarget, event: string, data: Record<string, any>, received: string, transport: BatLiveFrame["transport"]) => {
    buffer.push({ monitored_auction_id: target.id, event, data, received_at: received, transport });
  };
  const recover = async (target: BatLiveTarget) => {
    if (recovery.has(target.id) || stopped) return;
    recovery.add(target.id);
    // Snapshot request-start time prevents a late recovery response overwriting
    // newer live metadata. Native comments retain their own source timestamps.
    const requestedAt = new Date().toISOString();
    try {
      const data = await io.missed(target);
      if (!Array.isArray(data.comments) || data.comments.length > 5000 || !data.metadata) throw new Error("bat_recovery_invalid_or_capped");
      for (const c of data.comments.sort((a: any, b: any) => a.id - b.id)) {
        enqueue(target, "comment-added", { post_id: target.post_id, comment: c }, new Date().toISOString(), "missed_comments");
      }
      enqueue(target, "metadata-updated", data.metadata, requestedAt, "missed_comments");
      recoveryErrors.delete(target.id);
    } catch (error) { recoveryErrors.set(target.id, `recovery:${String(error)}`.slice(0, 500)); }
    finally { recovery.delete(target.id); }
  };
  const scheduleRecovery = (target: BatLiveTarget) => {
    const task = recover(target);
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  };
  const connect = () => {
    acknowledged.clear();
    const connection = io.socket?.(BAT_PUBLIC_SOCKET) ?? new WebSocket(BAT_PUBLIC_SOCKET);
    socket = connection;
    lastServerAt = Date.now();
    connection.onmessage = message => {
      if (socket !== connection) return;
      try {
        lastServerAt = Date.now();
        const frame = JSON.parse(String(message.data));
        const data = typeof frame.data === "string" ? JSON.parse(frame.data) : frame.data ?? {};
        if (frame.event === "pusher:connection_established") {
          if (lastError === "public_socket_error" || lastError === "public_socket_heartbeat_missing") lastError = null;
          for (const channel of channels.keys()) connection.send(JSON.stringify({ event: "pusher:subscribe", data: { channel } }));
        } else if (frame.event === "pusher_internal:subscription_succeeded") {
          acknowledged.add(frame.channel);
          const target = channels.get(frame.channel);
          if (target && frame.channel.startsWith("post;single;")) scheduleRecovery(target);
        } else if (frame.event === "pusher:ping") connection.send(JSON.stringify({ event: "pusher:pong", data: {} }));
        else if (frame.event === "pusher:error") throw new Error(`pusher:${JSON.stringify(data)}`);
        else if (!frame.event.startsWith("pusher")) {
          const target = channels.get(frame.channel);
          if (!target) throw new Error("bat_unbound_public_channel");
          enqueue(target, frame.event, data, new Date().toISOString(), "public_pusher");
          if (["update-auction-results", "listing-ended", "comment-deleted", "listing-reactivated"].includes(frame.event)) scheduleRecovery(target);
        }
      } catch (error) {
        lastError = String(error).slice(0, 500);
        // Stop source delivery if unacknowledged capacity is exhausted; health
        // reports the gap and existing workers/recovery retain native comments.
        if (lastError.includes("capacity")) socket?.close();
      }
    };
    connection.onclose = () => { if (socket === connection) { acknowledged.clear(); reconnectAt = Date.now() + 1000; } };
    connection.onerror = () => { if (socket === connection) { lastError = "public_socket_error"; connection.close(); } };
    reconnectAt = Date.now() + 15000;
  };
  connect();
  const currentSocket = (): WebSocket | null => socket;
  const expiresAt = Date.now() + durationMs;
  try {
    while (Date.now() < expiresAt) {
      const activeSocket = currentSocket();
      if ((!activeSocket || activeSocket.readyState > 1) && Date.now() >= reconnectAt) connect();
      if (activeSocket?.readyState === 0 && Date.now() >= reconnectAt) activeSocket.close();
      if (activeSocket?.readyState === 1 && Date.now() - lastPingAt >= 1000) {
        activeSocket.send(JSON.stringify({ event: "pusher:ping", data: {} })); lastPingAt = Date.now();
      }
      if (activeSocket?.readyState === 1 && lastServerAt && Date.now() - lastServerAt > 3000) {
        lastError = "public_socket_heartbeat_missing"; activeSocket.close();
      }
      try { await buffer.flush(); if (lastError?.startsWith("admission:")) lastError=null; }
      catch (error) { lastError = `admission:${String(error)}`.slice(0, 500); }
      if (Date.now() - lastRecoveryAt > 45000) {
        for (const target of targets) if (acknowledged.has(`post;single;${target.post_id}`)) scheduleRecovery(target);
        lastRecoveryAt = Date.now();
      }
      if (Date.now() - lastHeartbeatAt >= 1000) {
        const at = new Date().toISOString();
        await io.admit([], targets.map(t => ({ monitored_auction_id: t.id, session_id: sessionId, at,
          connected: ["single", "stats", "list"].every(type => acknowledged.has(`post;${type};${t.post_id}`)),
          pending: buffer.pending, oldest_received_at: buffer.oldestReceivedAt, error: recoveryErrors.get(t.id) || lastError })));
        lastHeartbeatAt = Date.now();
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally {
    stopped = true;
    currentSocket()?.close();
    await Promise.allSettled([...tasks]);
    await buffer.flush();
    // Leave the other overlapping worker's session intact.
    await io.admit([], targets.map(t => ({ monitored_auction_id: t.id, session_id: sessionId, at: new Date().toISOString(),
      connected: false, pending: buffer.pending, oldest_received_at: buffer.oldestReceivedAt, error: recoveryErrors.get(t.id) || lastError })));
  }
}

export function batStreamIO(url: string, key: string): BatStreamIO {
  return {
    admit: async (frames, heartbeats) => {
      const result = await fetch(`${url}/functions/v1/ingest-observation`, { method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: BAT_LIVE_MODE, frames, heartbeats }), signal: AbortSignal.timeout(10000) });
      if (!result.ok || (await result.json()).success !== true) throw new Error(`live_intake_http_${result.status}`);
    },
    missed: async target => {
      // Public JSON read endpoint used by BaT's own reconnect handler. No HTML.
      const result = await fetch("https://bringatrailer.com/wp-admin/admin-ajax.php", { method: "POST",
        body: new URLSearchParams({ action: "bat_listing_missed_comments", listing_id: String(target.post_id), last_comment: String(target.last_comment_id) }),
        signal: AbortSignal.timeout(10000) });
      if (!result.ok) throw new Error(`missed_comments_http_${result.status}`);
      return await result.json();
    },
  };
}
