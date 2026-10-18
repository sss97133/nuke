/**
 * ingest/craigslistSellerType.ts — the seller class of a Craigslist listing episode, recorded as a lot-level signal.
 *
 * Skylar's rule is non-dealer sellers first. The class is stated twice on a Craigslist page: the search it belongs to
 * (breadcrumb link, purveyor=owner or purveyor=dealer) and the title ("... for sale by owner"). The first is taken as
 * the declared class (confidence 0.9); a page that states neither is `unknown` (0). A private class whose own text uses
 * dealer wording is lowered by the shared helper (_shared/sellerType.ts). One row per listing episode (event), method
 * `ingest-craigslist-purveyor-v1`, written through record_lot_quality_signals. Spec:
 * docs/proposals/2026-10-15-seller-type-observation.md.
 */
import { sellerTypeRow, type LotSignalRow } from "../_shared/sellerType.ts";
import type { CraigslistSellerClass } from "../_shared/craigslistAttributes.ts";

export const SELLER_TYPE_METHOD = "ingest-craigslist-purveyor-v1";

const DEALER_WORDING: [string, RegExp][] = [
  ["dealer", /\bdealer(ship)?s?\b/i],
  ["financing", /\bfinanc(e|ing)\b/i],
  ["we offer", /\bwe (offer|finance|accept|ship|buy|sell|have|specialize)\b/i],
  ["trade-ins", /\btrade-?ins?\b/i],
  ["warranty", /\bwarrant(y|ies)\b/i],
  ["our inventory", /\bour (inventory|lot|showroom|selection|vehicles|team)\b/i],
  ["doc fee", /\b(doc|dealer|documentation) fees?\b/i],
  ["stock #", /\bstock\s*(#|no\.?|number)/i],
];

export function dealerWordingIn(text: string | null | undefined): string[] {
  const t = text ?? "";
  return DEALER_WORDING.filter(([, re]) => re.test(t)).map(([name]) => name);
}

export function craigslistSellerTypeRow(eventId: string, sellerClass: CraigslistSellerClass | undefined | null, description: string | null | undefined): LotSignalRow {
  const wording = dealerWordingIn(description);
  if (!sellerClass) return sellerTypeRow({ eventId, value: "unknown", basis: "inferred", method: SELLER_TYPE_METHOD });
  return sellerTypeRow({
    eventId,
    value: sellerClass.value === "dealer" ? "dealer" : "private",
    basis: "declared",
    field: sellerClass.field,
    text: sellerClass.text,
    dealerWording: wording,
    method: SELLER_TYPE_METHOD,
  });
}
