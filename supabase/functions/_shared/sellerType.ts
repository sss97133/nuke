/**
 * sellerType: the lane-facing writer for the lot-level seller type (docs/proposals/2026-10-15-seller-type-observation.md).
 *
 * One row per lot and per method in lot_quality_signal, signal 'seller_type', value private | dealer | unknown, written through
 * record_lot_quality_signals (service role, at most 500 rows a call). The evidence says where the class came from and how far to
 * trust it, so a declared label is never mistaken for an inference:
 *   { basis: 'declared' | 'inferred', field: '<the source's own label>', text: '<short quote>', confidence: 0..1, wording_terms?: [...] }
 *
 * Confidence rules (the same for every lane):
 *   declared by the source's own field   0.9
 *   inferred from handles, feeds or wording   0.5
 *   unknown   0 (and no wording is read into it)
 *   a PRIVATE class whose text still uses dealer wording loses 0.4 (floor 0.2): the declared label is a claim, and 29% of eBay
 *   listings marked private used dealer wording (lane-ebay audit, 2026-10-15). A dealer class is not lowered by wording.
 */
import { mustWrite } from "./writeResult.ts";

export type SellerType = "private" | "dealer" | "unknown";
export type SellerBasis = "declared" | "inferred";

export interface SellerTypeInput {
  eventId: string;
  value: SellerType;
  basis: SellerBasis;
  /** The source's own label, e.g. "For Sale By", "purveyor=owner", "sellerType". */
  field?: string | null;
  /** A short quote of what the page or feed said. */
  text?: string | null;
  /** Dealer wording found in the lot's own text (empty when none). */
  dealerWording?: string[];
  /** The lane or extractor name; never 'lexicon_v1' (reserved for the derived read). */
  method: string;
}

export interface LotSignalRow { event_id: string; signal: "seller_type"; value: SellerType; method: string; evidence: Record<string, unknown> }

export function sellerTypeConfidence(i: Pick<SellerTypeInput, "value" | "basis" | "dealerWording">): number {
  if (i.value === "unknown") return 0;
  const base = i.basis === "declared" ? 0.9 : 0.5;
  const lowered = i.value === "private" && (i.dealerWording?.length ?? 0) > 0 ? base - 0.4 : base;
  return Math.round(Math.max(0.2, lowered) * 100) / 100;
}

export function sellerTypeRow(i: SellerTypeInput): LotSignalRow {
  if (!i.method || i.method === "lexicon_v1") throw new Error("sellerTypeRow: method is required and lexicon_v1 is reserved");
  const evidence: Record<string, unknown> = { basis: i.basis, confidence: sellerTypeConfidence(i) };
  if (i.field) evidence.field = i.field;
  if (i.text) evidence.text = i.text.slice(0, 120);
  if (i.dealerWording?.length) evidence.wording_terms = i.dealerWording.slice(0, 8);
  return { event_id: i.eventId, signal: "seller_type", value: i.value, method: i.method, evidence };
}

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message: string } | null }> };

/** Write rows in chunks of 500; a failed chunk throws (mustWrite). Returns the number of rows the writer accepted. */
export async function recordSellerTypes(supabase: Rpc, rows: LotSignalRow[], writtenBy: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const r = mustWrite("record_lot_quality_signals", await supabase.rpc("record_lot_quality_signals", { p_rows: rows.slice(i, i + 500), p_written_by: writtenBy }));
    n += Number(r.data ?? 0);
  }
  return n;
}
