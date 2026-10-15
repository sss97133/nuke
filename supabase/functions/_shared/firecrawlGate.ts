/**
 * firecrawlGate: ask first, record after (owner-lead rule, 2026-10-15). A paid Firecrawl fetch happens only when
 * firecrawl_allowance(source) says a credit may be spent today, and every paid fetch is written to firecrawl_spend_log
 * through firecrawl_record_spend, failed fetches included. Cache hits cost nothing and are never gated.
 */
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message: string } | null }> };

/** The poller reads "allowance_deferred" as a deferral (poll-listing-feeds/ledger.ts): no ledger row, no attempt counted. */
export const ALLOWANCE_EXHAUSTED = "allowance_deferred: firecrawl allowance exhausted for today";

export function firecrawlGate(supabase: Rpc, source: string) {
  return {
    /** True when at least one credit may be spent today for this source. An unreadable allowance is a no. */
    async allow(): Promise<boolean> {
      const r = await supabase.rpc("firecrawl_allowance", { p_source: source });
      return !r.error && Number(r.data) >= 1;
    },
    /** One row per paid fetch: credits spent, full lots landed (0 when the page did not parse). */
    async record(credits: number, lots: number, lane: string, note: string): Promise<void> {
      const r = await supabase.rpc("firecrawl_record_spend", { p_source: source, p_credits: credits, p_lots: lots, p_lane: lane, p_note: note });
      if (r.error) console.error(`[firecrawlGate] could not record ${credits} credit(s) for ${source}: ${r.error.message}`);
    },
  };
}
