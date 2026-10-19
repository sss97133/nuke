// Run: deno test supabase/functions/extract-ebay-motors/
// Snippets follow the text of real archived pages (2009 W0QQ era, 2011-2013 ViewItem era); no seller text is copied.
import { archivedPageToItem, archiveItemId, endedAtIso, parseArchivedItemPage, plausibleVin } from "./archivePage.ts";

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

const era2009 = (status: string) => `<html><head><title>International Harvester : Scout:eBay Motors (item 160383911052 end time  Dec-13-09 18:00:00 PST)</title></head><body>
<div>Bidding has ended on this item.</div><div>${status}</div>
<div>Item Location: Arvada, CO, United States</div><div>A reserve price is the minimum price</div>
<div>Seller info honestsav ( 1085 ) 99% Positive feedback</div><div>Item number: 160383911052</div><div>Item condition: Used</div>
<div>Vehicle History Report Summary for 1977 International Harvester Scout SCOUT 2</div>
<div>Mileage: 121,540 miles</div><div>Location: Arvada, CO</div><div>Vehicle Information</div><div>VIN: G0o6ZGGD11535 | See the free Vehicle History Report</div>
<img src="http://i.ebayimg.com/14/!Bgnf~~_14.JPG"><img src="http://i.ebayimg.com/14/!Bgnf~~_35.JPG"><img src="http://i.ebayimg.com/24/!BgnY~~_14.JPG">
<div id="ngvi_desc_div"><div><p>Runs and drives.</p></div></div></body></html>`;

const era2013 = (status: string) => `<html><head><title>Toyota : Land Cruiser FJ40 in Toyota | eBay Motors</title></head><body>
<h1 id="itemTitle">1977 Toyota Land Cruiser FJ40</h1><div>This listing has ended.</div><div>${status}</div>
<div>Seller info Member id northjerseyautomall ( Feedback Score Of 688 ) 100% Positive feedback</div>
<div>Item number: 380581917878</div><div>Item condition: Used</div><div>Item specifics</div>
<div>VIN: XXXXXXXFJ40255430 | See the full History Report</div><div>Year: 1977</div><div>Make: Toyota</div><div>Model: Land Cruiser</div>
<div>Mileage: 11,200</div><div>For Sale By: Dealer</div></body></html>`;

Deno.test("2009 winning bid: outcome, price, bids, Pacific end time, specifics and the year from the history summary", () => {
  const p = parseArchivedItemPage(era2009("Ended: Dec 13, 2009 18:00:00 PST Bid history: 19 bids Winning bid: US $2,050.00 Get low monthly payments"));
  eq([p.itemId, p.outcome, p.priceLabel, p.priceShown, p.bids, p.endedAt], ["160383911052", "winning_bid", "Winning bid", 2050, 19, "2009-12-14T02:00:00.000Z"]);
  eq([p.specifics.Year, p.specifics.Make, p.specifics.Model, p.specifics.Mileage, p.location], ["1977", "International Harvester", "Scout", "121,540 miles", "Arvada, CO"]);
  eq([p.sellerUsername, p.sellerFeedbackCount, p.images.length, p.description], ["honestsav", 1085, 2, "Runs and drives."]);
  eq(p.images[0], "http://i.ebayimg.com/14/!Bgnf~~_35.JPG");
});

Deno.test("reserve not met keeps the high bid as a bid, not a sale; 0 bids is no-bids; seller-ended is withdrawn", () => {
  const r = parseArchivedItemPage(era2009("Ended: Nov 19, 2009 15:50:27 PST Bid history: 9 bids Current bid: US $405.00 Reserve not met"));
  eq([r.outcome, r.priceLabel, r.priceShown, r.reserveNotMet], ["reserve_not_met", "Current bid", 405, true]);
  const n = parseArchivedItemPage(era2009("Ended: Nov 18, 2009 08:42:41 PST Bid history: 0 bids Starting bid: US $3,000.00"));
  eq([n.outcome, n.priceShown], ["ended_no_bids", 3000]);
  const s = parseArchivedItemPage(era2009("This listing was ended by the seller because the item is no longer available. Ended: May 25, 2011 12:01:29 PDT Bid history: 0 bids Starting bid: US $0.99"));
  eq([s.outcome, s.endedAt], ["ended_by_seller", "2011-05-25T19:01:29.000Z"]);
});

Deno.test("2013 fixed-price sale: Sold For, the heading title and labelled specifics", () => {
  const p = parseArchivedItemPage(era2013("Ended: Feb 28, 2013 15:49:08 PST Sold For: US $29,750.00"));
  eq([p.title, p.outcome, p.priceShown, p.endedAt], ["1977 Toyota Land Cruiser FJ40", "sold_for", 29750, "2013-02-28T23:49:08.000Z"]);
  eq([p.specifics.Year, p.specifics.Make, p.specifics.Model, p.specifics.VIN, p.specifics["For Sale By"]], ["1977", "Toyota", "Land Cruiser", "XXXXXXXFJ40255430", "Dealer"]);
});

Deno.test("a capture taken while the listing ran is live, with the bid shown", () => {
  const p = parseArchivedItemPage(era2013("Bid history: 4 bids Current bid: US $1,250.00 Place bid Time left: 2d 3h").replace("This listing has ended.", ""));
  eq([p.outcome, p.priceLabel, p.priceShown, p.endedAt], ["live", "Current bid", 1250, null]);
});

Deno.test("item ids from each archived URL form; end time in both zones; photos point at the archive", () => {
  eq(archiveItemId("http://cgi.ebay.com:80/ebaymotors/1950-Plymouth-Coupe_W0QQitemZ370013714329QQcmdZViewItem?"), "370013714329");
  eq(archiveItemId("http://cgi.ebay.com:80/ebaymotors/1950-Plymouth-Club-Coupe-/260705221058?"), "260705221058");
  eq(archiveItemId("http://cgi.ebay.com/ebaymotors/ViewItem?item=260324015705"), "260324015705");
  eq(archiveItemId("http://cgi.ebay.com/ebaymotors/"), null);
  eq(endedAtIso("Jul 18, 2013 14:49:21 PDT"), "2013-07-18T21:49:21.000Z");
  eq(endedAtIso("Dec-13-09 18:00:00 PST"), "2009-12-14T02:00:00.000Z");
  const item = archivedPageToItem(parseArchivedItemPage(era2009("Ended: Dec 13, 2009 18:00:00 PST Bid history: 19 bids Winning bid: US $2,050.00")), "20091215000000");
  eq([item.legacyItemId, item.itemEndDate, item.bidCount, item.image?.imageUrl], ["160383911052", "2009-12-14T02:00:00.000Z", 19, "https://web.archive.org/web/20091215000000im_/http://i.ebayimg.com/14/!Bgnf~~_35.JPG"]);
  eq(item.localizedAspects?.find((a) => a.name === "Mileage")?.value, "121,540");
});

Deno.test("2010-11 sentence-case labels end at the next label; a masked or run-on VIN is dropped", () => {
  const html = `<html><head><title>1977 Toyota Corolla | eBay</title></head><body><h1>1977 Toyota Corolla</h1>
<div>Ended: Mar 18, 2012 19:06:32 PDT Bid history: 12 bids Winning bid: US $9,450.00</div><div>Item number: 120874652371</div><div>Item condition: Used</div>
<div>VIN: XXXXXXX51564213 | See the full History Report</div><div>Mileage: 55,105 miles Hi I am selling my car</div>
<div>For Sale By: Private seller Features Body type: Hatchback Engine: 4 - Cyl. Cylinder Exterior color: Orange Transmission: Manual Fuel type: Gasoline</div></body></html>`;
  const p = parseArchivedItemPage(html);
  eq([p.specifics.Make, p.specifics.Model, p.specifics.Mileage, p.specifics["Body Type"], p.specifics["Exterior Color"], p.specifics.Transmission], ["Toyota", "Corolla", "55,105 miles", "Hatchback", "Orange", "Manual"]);
  const a = Object.fromEntries((archivedPageToItem(p, "20120320000000").localizedAspects ?? []).map((x) => [x.name, x.value]));
  eq([a.VIN, a.Mileage], [undefined, "55,105"]);
  eq(plausibleVin("F101CL22579|GETTHEVEHICLEHISTORYREPORT"), null);
  eq(plausibleVin("1q87l8n587965"), "1Q87L8N587965");
});

Deno.test("an 'eBay Motors: Make' title with no specifics takes make and model from the archived URL slug", () => {
  const html = `<html><head><title>eBay Motors: Ferrari (item 260345678901 end time Jan-10-09 18:00:00 PST)</title></head><body>
<div>Ended: Jan 10, 2009 18:00:00 PST Bid history: 3 bids Current bid: US $10,000.00 Reserve not met</div><div>Item number: 260345678901</div></body></html>`;
  const p = parseArchivedItemPage(html, "http://cgi.ebay.com:80/ebaymotors/1978-Ferrari-400-GT-Rare-5-Speed_W0QQitemZ260345678901QQcmdZViewItem");
  eq([p.specifics.Year, p.specifics.Make, p.specifics.Model, p.outcome, p.priceShown], ["1978", "Ferrari", "400", "reserve_not_met", 10000]);
});
