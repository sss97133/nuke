/**
 * T7: keep the stored live BaT bid fresh.
 *
 * evaluate_listing reads the lot page live, so it sees the current bid before Nuke's auction_events row does
 * (the audit found #206 stored at $20,993, 18 h old, while the page said $39,993). When the page bid differs
 * from the stored one, the lot is re-read through the existing writer — extract-bat-core, the same reader
 * bat_live_pull_run dispatches — so the stored row is corrected with its own provenance and guards. The
 * advisor never writes auction_events itself.
 */
import type { InvokeFunction } from "./instant_ingest.ts";

export interface StoredBidRow {
  id: string;
  high_bid: number | null;
  updated_at: string | null;
  outcome: string | null;
}

export type BidRefresh =
  | "dispatched"
  | "not_needed"
  | "throttled"
  | "unavailable"
  | "just_ingested";

export interface StoredBidCheck {
  auction_event_id: string | null;
  stored_high_bid: number | null;
  stored_updated_at: string | null;
  page_bid: number;
  behind: boolean;
  stored_age_hours: number | null;
  refresh: BidRefresh;
  note: string;
}

const REFRESH_SPACING_MS = 10 * 60_000;
const lastRefresh = new Map<string, number>();

/** Test hook. */
export function _resetBidRefreshState(): void {
  lastRefresh.clear();
}

/** Pure decision: is the stored bid behind the page? A page bid below the stored one is not "newer". */
export function storedBidBehind(
  row: StoredBidRow | null,
  pageBid: number,
): boolean {
  if (!(pageBid > 0)) return false;
  if (!row || row.high_bid == null) return true;
  return pageBid > Number(row.high_bid);
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/**
 * Compare the page bid with the stored row and, when behind, re-read the lot through extract-bat-core in the
 * background (the answer never waits on it). At most one refresh per lot per 10 min per isolate.
 */
export function checkStoredBid(
  row: StoredBidRow | null,
  pageBid: number,
  lotUrl: string,
  invoke: InvokeFunction | undefined,
  opts: { now?: number; justIngested?: boolean } = {},
): StoredBidCheck {
  const now = opts.now ?? Date.now();
  const behind = storedBidBehind(row, pageBid);
  const age = row?.updated_at
    ? Math.round(((now - Date.parse(row.updated_at)) / 3_600_000) * 10) / 10
    : null;
  const base = {
    auction_event_id: row?.id ?? null,
    stored_high_bid: row?.high_bid == null ? null : Number(row.high_bid),
    stored_updated_at: row?.updated_at ?? null,
    page_bid: pageBid,
    behind,
    stored_age_hours: age,
  };
  if (opts.justIngested) {
    return {
      ...base,
      behind: false,
      refresh: "just_ingested",
      note: "Landed from this page moments ago",
    };
  }
  if (!behind) {
    return {
      ...base,
      refresh: "not_needed",
      note: "Stored bid matches the page",
    };
  }
  if (!invoke) {
    return {
      ...base,
      refresh: "unavailable",
      note: "Stored bid is behind the page; no writer configured here",
    };
  }
  const last = lastRefresh.get(lotUrl);
  if (last != null && now - last < REFRESH_SPACING_MS) {
    return {
      ...base,
      refresh: "throttled",
      note:
        "Stored bid is behind the page; a refresh was dispatched under 10 min ago",
    };
  }
  lastRefresh.set(lotUrl, now);
  const p = invoke(
    "extract-bat-core",
    { url: lotUrl, prefer_snapshot: false },
    { timeoutMs: 60_000 },
  )
    .catch((e) =>
      console.warn(
        `[evaluate_listing] live bid refresh failed for ${lotUrl}: ${
          e instanceof Error ? e.message : e
        }`,
      )
    );
  try {
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(p);
    }
  } catch { /* not in the edge runtime */ }
  return {
    ...base,
    refresh: "dispatched",
    note:
      "Stored bid is behind the page; re-read through extract-bat-core dispatched",
  };
}
