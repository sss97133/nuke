/** The clock of the page used for this extraction, independent of extraction/write time. */
export function sourceReadClock(source: "direct" | "snapshot", fetchedAt: string | null, bidAmount?: number | null) {
  const milliseconds = fetchedAt ? Date.parse(fetchedAt) : NaN;
  const at = Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  return {
    scraped_at: at,
    source_read: {
      clock_version: 1,
      at,
      basis: at ? (source === "direct" ? "direct_fetch" : "cached_snapshot") : "unknown",
      // Forward binding: a later partial high_bid write must not inherit this page's clock.
      ...(bidAmount !== undefined ? { bid_amount_version: 1,
        bid_amount: at && Number.isFinite(bidAmount) && (bidAmount ?? 0) > 0 ? bidAmount : null,
        bid_currency: null } : {}), // The existing numeric parser does not independently capture currency.
    },
  };
}
