/**
 * Build a stable "auction pulse" for the header from external listing rows.
 * Merges duplicate rows that share the same listing_url (from multiple import pipelines)
 * so the UI doesn't flip to SOLD just because a stale duplicate row updated last.
 *
 * This is a pure function -- no React state or side effects.
 */
export function buildAuctionPulseFromExternalListings(rows: any[], vehicleIdForRows: string): any | null {
  const arr = Array.isArray(rows) ? rows.filter((r) => r && r.listing_url && r.platform) : [];
  if (arr.length === 0) return null;
  // NOTE: We intentionally do NOT globally drop active listings when a vehicle has a historical sale.
  // Relists exist (e.g. BaT "-2" URLs), and we want the pulse to reflect the current live auction when present.
  // Duplicate rows for the *same* listing URL are merged below.

  const now = Date.now();
  const toLower = (v: any) => String(v || '').toLowerCase();
  const parseTs = (v: any) => {
    try {
      if (v === null || typeof v === 'undefined') return NaN;
      // Support unix timestamps (seconds or millis) in addition to ISO strings.
      if (typeof v === 'number' && Number.isFinite(v)) {
        const ms = v < 1e12 ? v * 1000 : v;
        return Number.isFinite(ms) ? ms : NaN;
      }
      const s = String(v).trim();
      if (!s) return NaN;
      if (/^\d{9,14}$/.test(s)) {
        const n = Number(s);
        if (!Number.isFinite(n)) return NaN;
        return n < 1e12 ? n * 1000 : n;
      }
      const t = new Date(s).getTime();
      return Number.isFinite(t) ? t : NaN;
    } catch {
      return NaN;
    }
  };

  const maxAuctionHorizonMs = (platform: string, url: string) => {
    const p = toLower(platform);
    const u = toLower(url);
    // Auction-style platforms should never show 30+ day countdowns.
    if (p === 'bat' || u.includes('bringatrailer.com')) return 10 * 24 * 60 * 60 * 1000;
    if (p === 'cars_and_bids' || u.includes('carsandbids.com')) return 10 * 24 * 60 * 60 * 1000;
    if (p.includes('ebay') || u.includes('ebay.com')) return 21 * 24 * 60 * 60 * 1000;
    // Default: 14 days (keeps us from rendering obvious garbage timers).
    return 14 * 24 * 60 * 60 * 1000;
  };

  const byUrl = new Map<string, any[]>();
  for (const r of arr) {
    const url = String(r.listing_url || '').trim();
    if (!url) continue;
    const list = byUrl.get(url) || [];
    list.push(r);
    byUrl.set(url, list);
  }

  const scoreRow = (r: any) => {
    const status = toLower(r?.listing_status);
    const end = parseTs(r?.end_date);
    const endFuture = Number.isFinite(end) ? end > now : false;
    const hasTelemetry =
      typeof r?.current_bid === 'number' ||
      typeof r?.bid_count === 'number' ||
      typeof r?.watcher_count === 'number' ||
      typeof r?.view_count === 'number' ||
      (typeof r?.metadata?.comment_count === 'number');
    const hasFinalPrice = typeof r?.final_price === 'number' && Number.isFinite(r.final_price) && r.final_price > 0;
    const hasLiveSignals =
      endFuture ||
      (typeof r?.current_bid === 'number' && Number.isFinite(r.current_bid) && r.current_bid > 0) ||
      (typeof r?.bid_count === 'number' && Number.isFinite(r.bid_count) && r.bid_count > 0);

    // Prefer rows that are demonstrably live or demonstrably sold.
    if (status === 'sold' && hasFinalPrice) return 5;
    if ((status === 'active' || status === 'live') && hasLiveSignals) return 4;
    if (status === 'sold') return 3;
    if (status === 'active' || status === 'live') return 2;
    if (endFuture) return 2;
    if (hasTelemetry) return 1;
    return 0;
  };

  const maxNum = (vals: any[]) => {
    const nums = vals.map((v) => (typeof v === 'number' ? v : Number.NaN)).filter((n) => Number.isFinite(n));
    return nums.length ? Math.max(...nums) : null;
  };

  const mergeGroup = (group: any[]) => {
    const sorted = (group || []).slice().sort((a, b) => {
      const as = scoreRow(a);
      const bs = scoreRow(b);
      if (as !== bs) return bs - as;
      const au = parseTs(a?.updated_at);
      const bu = parseTs(b?.updated_at);
      if (Number.isFinite(au) && Number.isFinite(bu) && au !== bu) return bu - au;
      return 0;
    });

    const best = sorted[0];
    if (!best) return null;

    // Prefer telemetry values from the "best" (highest-signal, freshest) row instead of max() across duplicates.
    const pickNum = (key: string) => {
      for (const r of sorted) {
        const v = (r as any)?.[key];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      }
      return null;
    };

    const statuses = sorted.map((r) => toLower(r?.listing_status)).filter(Boolean);
    const hasActive = statuses.some((s) => s === 'active' || s === 'live');
    const hasSold = statuses.some((s) => s === 'sold');
    const hasRNM = statuses.some((s) => s === 'reserve_not_met');
    const hasNoSale = statuses.some((s) => s === 'no_sale');
    const hasEnded = statuses.some((s) => s === 'ended' || s === 'expired' || s === 'cancelled');
    const mergedStatus = (() => {
      const anyFinal = maxNum(sorted.map((r) => r?.final_price));
      const anySoldAt = sorted.some((r) => {
        const t = parseTs(r?.sold_at);
        return Number.isFinite(t);
      });
      // SOLD requires a real "sold" signal (status or sold_at), not merely a numeric final_price.
      const soldEvidence = (hasSold && typeof anyFinal === 'number' && anyFinal > 0) || anySoldAt;
      if (soldEvidence) return 'sold';
      // Explicit unsold outcomes should override stale/ambiguous numeric prices.
      if (hasRNM) return 'reserve_not_met';
      if (hasNoSale) return 'no_sale';
      // Otherwise, keep active if we have active/live.
      if (hasActive) return 'active';
      if (hasSold) return 'sold';
      if (hasEnded) return 'ended';
      return String(best.listing_status || '');
    })();

    const commentCounts = sorted.map((r) => (typeof r?.metadata?.comment_count === 'number' ? r.metadata.comment_count : null));
    const mergedCommentCount = maxNum(commentCounts);

    const endCandidates = sorted
      .flatMap((r) => {
        const direct = r?.end_date ? [r.end_date] : [];
        const meta = r?.metadata?.auction_end_date ? [r.metadata.auction_end_date] : [];
        return [...direct, ...meta];
      })
      .filter(Boolean)
      .map((iso) => ({ iso: String(iso), t: parseTs(iso) }))
      .filter((x) => Number.isFinite(x.t));
    const horizonMs = maxAuctionHorizonMs(String(best.platform || ''), String(best.listing_url || ''));
    const futureEnd = endCandidates
      .filter((x) => x.t > now && (x.t - now) <= horizonMs)
      .sort((a, b) => a.t - b.t)[0];
    // If no reasonable future end date exists, don't render a countdown (avoid misleading UI).
    const mergedEndDate = (futureEnd?.iso || null) as string | null;

    const updatedAt = (() => {
      const ts = sorted
        .map((r) => ({ iso: r?.updated_at ? String(r.updated_at) : null, t: parseTs(r?.updated_at) }))
        .filter((x) => x.iso && Number.isFinite(x.t))
        .sort((a, b) => b.t - a.t)[0];
      return ts?.iso || null;
    })();

    const soldAt = (() => {
      const ts = sorted
        .map((r) => ({ iso: r?.sold_at ? String(r.sold_at) : null, t: parseTs(r?.sold_at) }))
        .filter((x) => x.iso && Number.isFinite(x.t))
        .sort((a, b) => b.t - a.t)[0];
      return ts?.iso || null;
    })();

    // Ensure current_bid is a number (handle string values from DB)
    const parseCurrentBid = (val: any): number | null => {
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      if (typeof val === 'string') {
        const parsed = parseFloat(val.replace(/[^0-9.]/g, ''));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      }
      return null;
    };

    const currentBidCandidates = sorted
      .map((r) => parseCurrentBid(r?.current_bid))
      .filter((v): v is number => v !== null);
    const mergedCurrentBid = currentBidCandidates.length > 0 ? Math.max(...currentBidCandidates) : null;

    return {
      external_listing_id: String(best.id || ''),
      platform: String(best.platform || ''),
      listing_url: String(best.listing_url || ''),
      listing_status: mergedStatus,
      end_date: mergedEndDate,
      current_bid: mergedCurrentBid,
      bid_count: pickNum('bid_count'),
      watcher_count: pickNum('watcher_count'),
      view_count: pickNum('view_count'),
      comment_count: mergedCommentCount,
      final_price: maxNum(sorted.map((r) => r?.final_price)),
      sold_at: soldAt,
      last_bid_at: null as string | null,
      last_comment_at: null as string | null,
      updated_at: updatedAt,
      metadata: (best?.metadata && typeof best.metadata === 'object') ? best.metadata : null,
      _vehicle_id: vehicleIdForRows,
    };
  };

  const mergedGroups = Array.from(byUrl.values()).map(mergeGroup).filter(Boolean) as any[];
  if (mergedGroups.length === 0) return null;

  // Selection rules:
  // - Prefer a *real* active auction (future end_date within platform horizon)
  // - Else prefer the most recent SOLD by sold_at (handles relists cleanly)
  // - Else fall back to freshest updated_at
  const activeCandidates = mergedGroups.filter((g) => {
    const status = toLower(g?.listing_status);
    if (status !== 'active' && status !== 'live') return false;
    const end = parseTs(g?.end_date);
    return Number.isFinite(end) && end > now;
  });

  if (activeCandidates.length > 0) {
    activeCandidates.sort((a, b) => {
      const ae = parseTs(a?.end_date);
      const be = parseTs(b?.end_date);
      if (Number.isFinite(ae) && Number.isFinite(be) && ae !== be) return ae - be; // soonest-ending first
      const au = parseTs(a?.updated_at);
      const bu = parseTs(b?.updated_at);
      if (Number.isFinite(au) && Number.isFinite(bu) && au !== bu) return bu - au;
      return 0;
    });
    return activeCandidates[0] || null;
  }

  const soldCandidates = mergedGroups.filter((g) => {
    const status = toLower(g?.listing_status);
    const final = typeof g?.final_price === 'number' ? g.final_price : Number.NaN;
    const soldAt = parseTs(g?.sold_at);
    return status === 'sold' && ((Number.isFinite(final) && final > 0) || Number.isFinite(soldAt));
  });

  if (soldCandidates.length > 0) {
    soldCandidates.sort((a, b) => {
      const as = parseTs(a?.sold_at);
      const bs = parseTs(b?.sold_at);
      if (Number.isFinite(as) && Number.isFinite(bs) && as !== bs) return bs - as; // newest sale first
      const au = parseTs(a?.updated_at);
      const bu = parseTs(b?.updated_at);
      if (Number.isFinite(au) && Number.isFinite(bu) && au !== bu) return bu - au;
      return 0;
    });
    return soldCandidates[0] || null;
  }

  mergedGroups.sort((a, b) => {
    const au = parseTs(a?.updated_at);
    const bu = parseTs(b?.updated_at);
    if (Number.isFinite(au) && Number.isFinite(bu) && au !== bu) return bu - au;
    return 0;
  });

  return mergedGroups[0] || null;
}
