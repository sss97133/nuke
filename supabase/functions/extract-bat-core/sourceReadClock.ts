/** The clock of the page used for this extraction, independent of extraction/write time. */
export function sourceReadClock(source: "direct" | "snapshot", fetchedAt: string | null) {
  const milliseconds = fetchedAt ? Date.parse(fetchedAt) : NaN;
  const at = Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  return {
    scraped_at: at,
    source_read: {
      clock_version: 1,
      at,
      basis: at ? (source === "direct" ? "direct_fetch" : "cached_snapshot") : "unknown",
    },
  };
}
