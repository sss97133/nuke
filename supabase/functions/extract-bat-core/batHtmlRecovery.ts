import { BAT_LIVE_MODE, type BatLiveFrame } from "../_shared/batLiveEvents.ts";

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
