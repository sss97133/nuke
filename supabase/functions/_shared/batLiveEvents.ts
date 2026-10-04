/** Public BaT Pusher events, measured 2026-10-04. No auction-clock inference.
 * Raw frames become immutable observations; the native auction record alone
 * qualifies a result. Transport receipt time is explicit when event time is absent.
 */
import { buildAuctionCommentRows, sha256Hex, summarizeAuction } from "./batAuctionRecord.ts";

export const BAT_LIVE_MODE = "bat_live_events_v1";
export const BAT_PUBLIC_SOCKET = "wss://ws-us3.pusher.com/app/dea479875ad558950918?protocol=7&client=js&version=7.0.0&flash=false";
export interface BatLiveTarget {
  id: string; vehicle_id: string; post_id: number; source_url: string;
  last_comment_id: number;
}
export interface BatLiveFrame {
  monitored_auction_id: string; event: string; data: Record<string, any>;
  received_at: string; transport: "public_pusher" | "missed_comments" | "direct_html";
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function batUrl(value: string): string {
  const u = new URL(value);
  if (u.protocol !== "https:" || !["bringatrailer.com", "www.bringatrailer.com"].includes(u.hostname)
    || !/^\/listing\/[^/]+\/?$/.test(u.pathname) || u.search || u.hash) throw new Error("invalid_bat_listing_url");
  return `https://bringatrailer.com${u.pathname.replace(/\/$/, "")}`;
}
const positive = (v: any) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
const amount = (v: any) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const integer = (v: any) => Number.isSafeInteger(v) && v >= 0 ? v : null;
const unix = (v: any) => positive(v) && v >= 1577836800 && v < 4102444800 ? new Date(v * 1000).toISOString() : null;

export async function prepareBatLiveFrame(frame: BatLiveFrame, target: BatLiveTarget) {
  if (!uuid.test(target.id) || !uuid.test(target.vehicle_id) || !Number.isSafeInteger(target.post_id) || target.post_id <= 0
    || frame.monitored_auction_id !== target.id || !frame.data || typeof frame.data !== "object" || Array.isArray(frame.data)
    || !/^[a-z][a-z0-9-]{0,80}$/.test(frame.event) || !Number.isFinite(Date.parse(frame.received_at))
    || !["public_pusher", "missed_comments", "direct_html"].includes(frame.transport)) throw new Error("invalid_bat_live_frame");
  const sourceUrl = batUrl(target.source_url);
  const d = frame.data;
  const comment = frame.event === "comment-added" ? d.comment : null;
  const postId = d.post_id ?? comment?.post ?? (frame.event === "comments-updated" ? d.content : null);
  if (postId != null && Number(postId) !== target.post_id) throw new Error("bat_live_post_mismatch");
  if (comment?.post != null && Number(comment.post) !== target.post_id) throw new Error("bat_live_post_mismatch");
  const qualifiedComment = comment && positive(comment.id) && unix(comment.timestamp) && Number(comment.post) === target.post_id;
  const projectionError = comment && !qualifiedComment ? "native_comment_identity_or_source_clock_unqualified" : null;
  const nativeTime = qualifiedComment ? unix(comment.timestamp) : null;
  const observedAt = nativeTime || frame.received_at;
  // Native comment identity survives reconnect and overlap. Other source events
  // have no published sequence/id: retain distinct 5-second receipt windows,
  // including reversals, and claim neither exact publication time nor exactly-once delivery.
  const identity = comment && positive(comment.id) ? `comment:${comment.id}` : `receipt-window:${Math.floor(Date.parse(frame.received_at) / 5000)}`;
  const rawJson = JSON.stringify({ event: frame.event, data: d });
  if (new TextEncoder().encode(rawJson).byteLength > 262144) throw new Error("bat_live_frame_too_large");
  const hash = await sha256Hex([target.id, sourceUrl, identity, rawJson].join("|"));
  const auction = summarizeAuction(qualifiedComment ? [comment] : []);
  const outcome = auction.sold ? "sold" : auction.reserveNotMet ? "reserve_not_met" : null;
  const endAt = unix(d.end_timestamp ?? comment?.end_timestamp ?? d.listing_card_data?.timestamp_end);
  const metadata = frame.event === "metadata-updated";
  const stats = frame.event === "stats-updated";
  const commentRows = qualifiedComment ? await buildAuctionCommentRows({ rawComments: [comment], listingUrlNorm: sourceUrl,
    vehicleId: target.vehicle_id, auctionEventId: null, endAt: endAt ? new Date(endAt) : null }) : [];
  if (commentRows[0]) commentRows[0].content_hash = await sha256Hex(`bat|${sourceUrl}|native-comment:${comment.id}`);
  return {
    monitored_auction_id: target.id, post_id: target.post_id, vehicle_id: target.vehicle_id, source_url: sourceUrl,
    event: frame.event, source_identifier: `public-live:${target.post_id}:${frame.event}:${identity}:${hash}`,
    content_hash: hash, observed_at: observedAt, received_at: frame.received_at,
    kind: outcome ? "sale_result" : comment ? (commentRows[0]?.comment_type === "bid" ? "bid" : "comment") : "listing",
    content_text: comment ? String(comment.content ?? "") : null,
    raw_frame_json: rawJson, transport: frame.transport,
    clock_basis: nativeTime ? "native_comment_timestamp" : "collector_receipt_time_publication_unknown",
    end_at: endAt, current_bid: metadata ? amount(d.current_numeric) : positive(commentRows[0]?.bid_amount),
    bid_count: metadata ? integer(d.count) : null,
    high_bidder: metadata && typeof d.high_bidder_username === "string" ? d.high_bidder_username : null,
    views: stats ? integer(d.views_numeric) : null, watchers: stats ? integer(d.watchers_numeric) : null,
    comment_count: frame.event === "comments-updated" ? integer(d.numeric) : null,
    native_comment_id: qualifiedComment ? comment.id : null, comment_row: commentRows[0] ?? null, projection_error: projectionError,
    outcome, sale_amount: outcome === "sold" ? auction.saleAmount : null,
    sale_at: outcome === "sold" ? auction.recordAt : null,
    buyer: outcome === "sold" ? auction.buyer : null,
    author_profile_url: commentRows[0] ? `https://bringatrailer.com/member/${encodeURIComponent(commentRows[0].author_username)}` : null,
  };
}

/** One acknowledgement loop, retaining the complete unacknowledged prefix on failure. */
export class BatLiveBuffer {
  private frames: BatLiveFrame[] = [];
  private draining = false;
  constructor(private admit: (frames: BatLiveFrame[]) => Promise<void>, private capacity = 5000) {}
  get pending() { return this.frames.length; }
  get oldestReceivedAt() { return this.frames[0]?.received_at ?? null; }
  push(frame: BatLiveFrame) {
    if (this.frames.length >= this.capacity) throw new Error("bat_live_unacknowledged_capacity_exceeded");
    this.frames.push(frame);
  }
  async flush() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.frames.length) {
        const batch = this.frames.slice(0, 50);
        await this.admit(batch);
        this.frames.splice(0, batch.length);
      }
    } finally { this.draining = false; }
  }
}
