// Synthetic fixtures shaped from eBay's public pages as read 2026-10-15 (not captured text of any listing).
import { assertEquals } from "jsr:@std/assert@1";
import { discover } from "./firecrawlSweep.ts";
import { pageToItem, parseItemPage, parseSearchCards, resultCount, searchUrl } from "./ebayPage.ts";
import { toLanding } from "./browseMap.ts";
import { htmlToText } from "../_shared/htmlToText.ts";

const card = (id: string, rows: string[]) =>
  `<li class="s-card s-card--horizontal"><a href="https://www.ebay.com/itm/${id}?x=1"><img></a>${rows.map((r) => `<div><span>${r}</span></div>`).join("")}</li>`;
const PLACEHOLDER = card("123456", ["Shop on eBay", "Brand New", "$20.00"]);
const SEARCH = `<h1 class="srp-controls__count-heading"><span class="BOLD">588</span> results</h1><ul>${PLACEHOLDER}`
  + card("111111111111", ["New Listing", "1969 Chevrolet C10", "Opens in a new window or tab", "Pre-Owned · ", "Automatic", "$18,500.00", "or Best Offer", "Located in United States", "Oct-14 20:18", "Year: 1969", "Miles: 81,250", "Brand: Chevrolet", "bob_c10 ", "100% positive (12)"])
  + card("222222222222", ["1965 Ford Mustang", "Opens in a new window or tab", "Pre-Owned · ", "$12,100.00", "6 bids", "Oct-14 19:00", "Year: 1965", "Brand: Ford", "ford_guy ", "96.3% positive (1.3K)"])
  + "</ul>";

Deno.test("search url uses the double-encoded facet names", () => {
  assertEquals(searchUrl([1964, 1965], "private"),
    "https://www.ebay.com/sch/i.html?_sacat=6001&_sop=10&_ipg=240&rt=nc&Model%2520Year=1964%7C1965&For%2520Sale%2520By=Private%2520Seller&_dcat=6001");
  assertEquals(searchUrl([1974], "dealer", 2).endsWith("&_dcat=6001&_pgn=2"), true);
});

Deno.test("search cards: placeholder skipped, fields read, feedback counts expanded", () => {
  const cs = parseSearchCards(SEARCH);
  assertEquals(resultCount(SEARCH), 588);
  assertEquals(cs.map((c) => c.itemId), ["111111111111", "222222222222"]);
  assertEquals([cs[0].title, cs[0].price, cs[0].format, cs[0].year, cs[0].miles, cs[0].brand, cs[0].sellerUsername, cs[0].sellerFeedbackCount, cs[0].listedLabel, cs[0].condition],
    ["1969 Chevrolet C10", 18500, "best_offer", 1969, 81250, "Chevrolet", "bob_c10", 12, "Oct-14 20:18", "Pre-Owned"]);
  assertEquals([cs[1].format, cs[1].bids, cs[1].sellerFeedbackCount], ["auction", 6, 1300]);
});

const MD = `\n# 1969 Chevrolet C10\n\n![](https://i.ebayimg.com/x.png)\n\n[bob_c10](https://www.ebay.com/sch/bob_c10/m.html?item=1)\n\n(12)\n\n100% positive\n\nUS $18,500.00or Best Offer\n\n- [Buy It Now](https://pay.ebay.com/x)\n\n- [Make offer](https://x)\n\n## Item specifics\n\nCondition\n\nUsed: A vehicle is considered used if it has been registered. Read more\n\nYear\n\n1969\n\nVIN (Vehicle Identification Number)\n\nCE149Z123456\n\nMileage\n\n81250\n\nMake\n\nChevrolet\n\nModel\n\nC10\n\nFor Sale By\n\nPrivate Seller\n\nCategory\n\n## Item description from the seller\n\neBay\n\n![](https://i.ebayimg.com/y.png)\n\nSelling my dad's truck. Runs great.\n\n## About this seller\n\nLocated in: Reno, Nevada, United States\n\neBay item number:111111111111\n`;
const HTML = `<img data-zoom-src="https://i.ebayimg.com/images/g/AAA/s-l1600.webp"><img data-zoom-src="https://i.ebayimg.com/images/g/BBB/s-l1600.webp"><img data-zoom-src="https://i.ebayimg.com/images/g/AAA/s-l1600.webp">`;

Deno.test("item page: specifics, For Sale By, seller, photos, description", () => {
  const p = parseItemPage(HTML, MD);
  assertEquals([p.itemId, p.title, p.price, p.format, p.forSaleBy, p.sellerUsername, p.sellerFeedbackCount, p.location, p.images.length],
    ["111111111111", "1969 Chevrolet C10", 18500, "best_offer", "Private Seller", "bob_c10", 12, "Reno, Nevada", 2]);
  assertEquals(p.specifics["VIN (Vehicle Identification Number)"], "CE149Z123456");
  assertEquals(p.description, "Selling my dad's truck. Runs great.");
  const l = toLanding(pageToItem(p), htmlToText, "ebay-firecrawl")!;
  assertEquals([l.year, l.make, l.model, l.seller.class, l.eventMetadata.source], [1969, "Chevrolet", "C10", "likely_private", "ebay-firecrawl"]);
  assertEquals(l.seller.reasons.some((r) => r.includes("For Sale By = Private Seller")), true);
});

Deno.test("discover dry run reads the pages and writes nothing", async () => {
  let fetched = 0;
  const rep = await discover({}, {
    tiers: [1], dryRun: true,
    fetchPage: (async () => { fetched++; return { html: SEARCH, markdown: null, snapshotId: "s1", error: null, statusCode: 200 }; }) as any,
  });
  assertEquals([rep.ok, fetched, rep.search_pages, rep.cards, rep.facet_totals["1:private"]], [true, 1, 1, 2, 588]);
});

Deno.test("a search page that parses to no cards is an error, not silence", async () => {
  const rep = await discover({}, { tiers: [1], dryRun: true, fetchPage: (async () => ({ html: "<html>blocked</html>", markdown: null, snapshotId: "s2", error: null, statusCode: 200 })) as any });
  assertEquals(rep.ok, false);
  assertEquals(rep.errors[0].includes("0 cards"), true);
});
