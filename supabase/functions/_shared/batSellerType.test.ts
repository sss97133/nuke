// deno test supabase/functions/_shared/batSellerType.test.ts
// Synthetic fixtures shaped like the live essentials block; no real names or lots.
import { normalizeBatSellerType, readBatPartyLine } from "./batSellerType.ts";

function equal(actual: unknown, expected: unknown, label = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const block = (line: string) =>
  `<div class="essentials"><div class="item"><strong>Seller</strong>: <a href="/member/example/">example</a></div>` +
  `<div class="item"><strong>Location</strong>: <a href="#">Nowhere, Nevada</a></div>${line}` +
  `<div class="item"><strong>Lot</strong> #1</div></div>`;

Deno.test("Private Party line as BaT writes it", () => {
  const r = readBatPartyLine(block(`<div class="item additional"><strong>Private Party or Dealer</strong>: Private Party</div>`));
  equal(r, { party_type_raw: "Private Party", seller_type: "private" });
});

Deno.test("Dealer line, with the dealer-charges line after it", () => {
  const r = readBatPartyLine(block(
    `<div class="item additional"><strong>Private Party or Dealer</strong>: Dealer</div>` +
      `<div class="item additional"><strong>Additional charges from this dealer</strong>: USD $0</div>`,
  ));
  equal(r, { party_type_raw: "Dealer", seller_type: "dealer" });
});

Deno.test("absent line is null and null", () => {
  equal(readBatPartyLine(block("")), { party_type_raw: null, seller_type: null });
  equal(readBatPartyLine(""), { party_type_raw: null, seller_type: null });
  equal(readBatPartyLine(null), { party_type_raw: null, seller_type: null });
});

Deno.test("odd casing, spacing, entities and the colon inside the label", () => {
  equal(readBatPartyLine(block(`<div><strong>PRIVATE  PARTY or dealer</strong>:&nbsp; PRIVATE\n PARTY </div>`)),
    { party_type_raw: "PRIVATE PARTY", seller_type: "private" });
  equal(readBatPartyLine(block(`<div><strong>Private Party or Dealer:</strong> dealer</div>`)),
    { party_type_raw: "dealer", seller_type: "dealer" });
  equal(readBatPartyLine(block(`<div><strong>Private Party or Dealer</strong>: <a href="#">Dealer</a></div>`)),
    { party_type_raw: "Dealer", seller_type: "dealer" });
});

Deno.test("an unrecognized value keeps its raw text and gets no type", () => {
  equal(readBatPartyLine(block(`<div><strong>Private Party or Dealer</strong>: Auction House</div>`)),
    { party_type_raw: "Auction House", seller_type: null });
  equal(readBatPartyLine(block(`<div><strong>Private Party or Dealer</strong>: </div>`)),
    { party_type_raw: null, seller_type: null });
});

Deno.test("normalizer accepts only BaT's two values", () => {
  equal(["Private Party", " private ", "Dealer.", "DEALERSHIP", "broker", "", null, undefined].map(normalizeBatSellerType),
    ["private", "private", "dealer", "dealer", null, null, null, null]);
});
