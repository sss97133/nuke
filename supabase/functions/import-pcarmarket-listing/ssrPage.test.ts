import { parseSsrPage } from "./ssrPage.ts";

const page = (band: string, extra = "") =>
  `<title>1996 Porsche 993 Turbo — Sold | PCARMARKET</title><meta property="og:url" content="https://www.pcarmarket.com/results/x"/>` +
  `<p>Bids</p><p class="a"><svg><path/></svg>9</p>` +
  `<div class="x"><span class="flex h-6 items-center"><span class="whitespace-nowrap font-semibold">${band}</span></span><p data-slot="text" class="z">$127,000</p></div>` +
  `<h2>Car Details</h2><dl><div class="contents"><dt class="a">Year</dt><dd class="b">1996</dd></div><div><dt>Make</dt><dd>Porsche</dd></div>` +
  `<div><dt>Model</dt><dd>911 Turbo</dd></div><div><dt>VIN</dt><dd>WP0AC2995TS375612</dd></div><div><dt>Mileage Shown</dt><dd>37,300 mi</dd></div>` +
  `<div><dt>Ended</dt><dd><span>Mar 15, 2019, 8:30 PM</span></dd></div></dl>` +
  `<img src="https://assets.basta.app/a/images/1?width=1000&amp;quality=75"/>${extra}`;

Deno.test("Sold label means sold price", () => {
  const l = parseSsrPage(page("Sold"))!;
  if (l.auctionOutcome !== "sold" || l.salePrice !== 127000) throw new Error(JSON.stringify(l));
  if (l.year !== 1996 || l.vin !== "WP0AC2995TS375612" || l.mileage !== 37300 || l.bidCount !== 9) throw new Error(JSON.stringify(l));
  if (l.auctionEndDate !== "2019-03-15T20:30:00.000Z") throw new Error(String(l.auctionEndDate));
  if (l.images.length !== 1 || l.images[0].includes("?")) throw new Error(JSON.stringify(l.images));
});

Deno.test("Final bid label is a high bid, never a sale", () => {
  const l = parseSsrPage(page("Final bid"))!;
  if (l.auctionOutcome !== "reserve_not_met" || l.salePrice !== 127000) throw new Error(JSON.stringify(l));
});

Deno.test("a page without Car Details is null", () => {
  if (parseSsrPage("<title>Rolex</title>") !== null) throw new Error("expected null");
});
