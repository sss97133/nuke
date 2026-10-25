import { isBatSystemSoldComment, parseBatPageResult, plausibleBatSalePrice } from "./batResult.ts";
function eq(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
Deno.test("the page banner decides sold vs bid-to", () => {
  eq(parseBatPageResult('<span>Bid to <strong>USD $85,000</strong> on 2/27/22</span>'), { kind: "bid_to", amount: 85000 });
  eq(parseBatPageResult('Sold for <strong>USD $43,000</strong>'), { kind: "sold", amount: 43000 });
  eq(parseBatPageResult('<p>no banner</p>'), null);
});
Deno.test("user prose is not a sale comment; tiny prices are rejected", () => {
  eq(isBatSystemSoldComment("A similar one sold for $95k last year"), false);
  eq(isBatSystemSoldComment("Sold on 2/27/22 for $85,000 to bidder1"), true);
  eq(plausibleBatSalePrice(95), null);
  eq(plausibleBatSalePrice(85000), 85000);
});

Deno.test("score-live-auctions markup: the real Bid to banner is not a sale", () => {
  const page = '<script>{"textSoldOn":"Sold on"}</script><span class="info-value">Bid to <strong>USD $41,500</strong> <span class="date">on 10/10/25</span></span>"price": 41500';
  eq(parseBatPageResult(page), { kind: "bid_to", amount: 41500 });
});
