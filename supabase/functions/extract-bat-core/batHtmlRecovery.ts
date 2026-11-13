import { BAT_LIVE_MODE, type BatLiveFrame } from "../_shared/batLiveEvents.ts";

/** A relisted lot's inventory monitor can belong to a stub while its canonical
 * episode belongs to the original vehicle. The native intake owns that binding;
 * select only an unambiguous exact lot locator, never reassign either vehicle. */
export async function findBatHtmlRecoveryMonitor(db: any, urls: string[], resolvedVehicleId: string) {
  const slugs=[...new Set(urls.map(url=>{
    const u=new URL(url);
    if(!["https:","http:"].includes(u.protocol) || !["bringatrailer.com","www.bringatrailer.com"].includes(u.hostname)
      || u.username || u.password || u.port || !/^\/listing\/[^/]+\/?$/.test(u.pathname))
      throw new Error("BaT recovery lot locator invalid");
    return u.pathname.replace(/\/$/,"").split("/").pop()!;
  }))];
  if(slugs.length!==1) throw new Error("BaT recovery lot locator ambiguous");
  // The extractor includes its raw input alongside canonical variants. Tracking
  // parameters, www and HTTP inputs must not break an otherwise valid BaT lot.
  const canonical=`https://bringatrailer.com/listing/${slugs[0]}`;
  urls=[canonical,`${canonical}/`];
  const columns="id,vehicle_id,external_auction_url,auction_end_time,stream_state,is_live";
  const checked=(result:any)=>{
    if (result.error) throw new Error(`BaT native recovery monitor lookup failed: ${result.error.message}`);
    if (!Array.isArray(result.data) || result.data.length > 1)
      throw new Error("BaT native recovery monitor locator ambiguous");
    const monitor=result.data[0] ?? null;
    if (monitor && (!urls.includes(monitor.external_auction_url) || typeof monitor.id !== "string"))
      throw new Error("BaT native recovery monitor locator mismatch");
    return monitor;
  };
  const own=checked(await db.from("monitored_auctions").select(columns)
    .eq("vehicle_id",resolvedVehicleId).in("external_auction_url",urls).limit(2));
  if(own) return own;
  const source=await db.from("live_auction_sources").select("id").eq("slug","bat").single();
  if(source.error || typeof source.data?.id!=="string") throw new Error("BaT recovery source unavailable");
  // Reuse the existing unique (source_id, external_auction_id) index. A URL-only
  // fallback would scan all historical monitors on every normal page extraction.
  return checked(await db.from("monitored_auctions").select(columns)
    .eq("source_id",source.data.id).eq("external_auction_id",slugs[0])
    .in("external_auction_url",urls).limit(2));
}

/** Preserve native bid envelopes from the already fetched page, including outside
 * the closing window. This is historical recovery, never a connected session. */
export async function admitBatHtmlRecovery(args: {
  monitorId: string; comments: any[]; receivedAt: string | null; bidsOnly: boolean;
  admit: (body: { mode: string; frames: BatLiveFrame[]; heartbeats: never[] }) => Promise<{ success?: boolean; recorded?: number }>;
}) {
  if (!args.receivedAt || !Number.isFinite(Date.parse(args.receivedAt))) throw Error("BaT HTML recovery requires its actual capture clock");
  const receivedAt = args.receivedAt;
  const comments = args.bidsOnly
    ? args.comments.filter(c => c?.type === "bat-bid" || c?.type === "bat-bid-canceled") : args.comments;
  let recorded = 0;
  // The existing intake performs fresh monitor/source/native-post binding checks,
  // retains the complete frame, and owns deduplication and terminal projections.
  for (let at = 0; at < comments.length; at += 50) {
    const result = await args.admit({ mode: BAT_LIVE_MODE, heartbeats: [],
      frames: comments.slice(at, at + 50).map(comment => ({ monitored_auction_id: args.monitorId,
        event: "comment-added", data: { post_id: Number(comment.post), comment },
        received_at: receivedAt, transport: "direct_html" })) });
    if (result.success !== true) throw Error("BaT HTML native intake failed; no lossy bid fallback");
    recorded += result.recorded ?? 0;
  }
  return recorded;
}
