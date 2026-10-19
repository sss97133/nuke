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

// Native metadata frames expose a member link without a username field. Keep
// the displayed source alias only when its one canonical member route agrees.
// This is the current high bidder label, not a buyer or resolved person identity.
function metadataHighBidder(data: Record<string, any>): string | null {
  if (typeof data.high_bidder_username === "string") return data.high_bidder_username;
  if (typeof data.high_bidder_link !== "string" || data.high_bidder_link.length > 1024) return null;
  const match = /^(?:by|<span class="data-listing-high-bidder-link-text-by">by<\/span>)[ \t\r\n]+<a href="https:\/\/bringatrailer\.com\/member\/([A-Za-z0-9._-]{1,80})\/?" target="_blank">([A-Za-z0-9._-]{1,80})<\/a>$/.exec(data.high_bidder_link);
  return match && match[1].toLowerCase() === match[2].toLowerCase() ? match[2] : null;
}

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
  // A native comment (every bid is one) is keyed on its BaT comment id alone: the same bid arrives by public_pusher,
  // missed_comments and direct_html with differently shaped frames, and hashing the frame body made three rows of one
  // bid (110 of 172 vehicle+amount pairs in a 20-minute read, 2026-10-15). Frames without a native id keep the body hash.
  const hash = await sha256Hex(comment && positive(comment.id)
    ? [target.id, sourceUrl, identity, frame.event].join("|")
    : [target.id, sourceUrl, identity, rawJson].join("|"));
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
    high_bidder: metadata ? metadataHighBidder(d) : null,
    views: stats ? integer(d.views_numeric) : null, watchers: stats ? integer(d.watchers_numeric) : null,
    comment_count: frame.event === "comments-updated" ? integer(d.numeric) : null,
    native_comment_id: qualifiedComment ? comment.id : null, comment_row: commentRows[0] ?? null, projection_error: projectionError,
    outcome, sale_amount: outcome === "sold" ? auction.saleAmount : null,
    sale_at: outcome === "sold" ? auction.recordAt : null,
    buyer: outcome === "sold" ? auction.buyer : null,
    author_profile_url: commentRows[0] ? `https://bringatrailer.com/member/${encodeURIComponent(commentRows[0].author_username)}` : null,
  };
}

/** Wait between attempts for a lot the intake keeps rejecting: baseMs after the first failure, doubling with each
 * further one, never more than maxMs. Without a policy a rejected lot is retried on every flush. */
export interface BatLiveRetryPolicy { baseMs: number; maxMs: number }

/** One acknowledgement loop, ordered within each lot. A rejected lot retains
 * its complete unacknowledged prefix while independent lots can still drain. */
export class BatLiveBuffer {
  private frames: BatLiveFrame[] = [];
  private draining = false;
  private failures = new Map<string, string>();
  private waits = new Map<string, { failures: number; retryAt: number }>();
  constructor(private admit: (frames: BatLiveFrame[]) => Promise<void>, private capacity = 5000,
    private retry?: BatLiveRetryPolicy) {}
  get pending() { return this.frames.length; }
  get oldestReceivedAt() { return this.frames[0]?.received_at ?? null; }
  statusFor(id: string) {
    const frames = this.frames.filter(f => f.monitored_auction_id === id);
    return { pending: frames.length, oldestReceivedAt: frames[0]?.received_at ?? null,
      error: this.failures.get(id) ?? null };
  }
  push(frame: BatLiveFrame) {
    if (this.frames.length >= this.capacity) throw new Error("bat_live_unacknowledged_capacity_exceeded");
    this.frames.push(frame);
  }
  /** A lot still inside its wait is left alone (frames kept, last error kept) unless force is set, which the
   * worker's final flush uses so no lot ends a worker unattempted. */
  async flush(options: { force?: boolean } = {}) {
    if (this.draining) return;
    this.draining = true;
    try {
      const rejected = new Set<string>();
      let firstFailure: unknown;
      while (true) {
        const next = this.frames.find(f => !rejected.has(f.monitored_auction_id) && (options.force || this.due(f.monitored_auction_id)));
        if (!next) break;
        const id = next.monitored_auction_id;
        const batch = this.frames.filter(f => f.monitored_auction_id === id).slice(0, 50);
        try {
          await this.admit(batch);
          // Only remove the acknowledged prefix of this lot. Arrivals appended
          // while admission waits, including repeated frame objects, stay queued.
          let remaining = batch.length;
          this.frames = this.frames.filter(f => f.monitored_auction_id !== id || remaining-- <= 0);
          this.failures.delete(id);
          this.waits.delete(id);
        } catch (error) {
          rejected.add(id);
          this.failures.set(id, `admission:${String(error)}`.slice(0, 500));
          this.wait(id);
          firstFailure ??= error;
        }
      }
      if (rejected.size) throw firstFailure;
    } finally { this.draining = false; }
  }
  private due(id: string) {
    const wait = this.waits.get(id);
    return !wait || Date.now() >= wait.retryAt;
  }
  private wait(id: string) {
    if (!this.retry) return;
    const failures = (this.waits.get(id)?.failures ?? 0) + 1;
    this.waits.set(id, { failures, retryAt: Date.now() + Math.min(this.retry.maxMs, this.retry.baseMs * 2 ** (failures - 1)) });
  }
}
