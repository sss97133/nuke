// Run: deno test supabase/functions/extract-ebay-motors/
// Snippets follow the text of real archived pages (2009 W0QQ era, 2011-2013 ViewItem era); no seller text is copied.
import { archivedPageToItem, archivedPhotos, archiveItemId, endedAtIso, parseArchivedItemPage, plausibleVin, slugYear } from "./archivePage.ts";

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

const era2009 = (status: string) => `<html><head><title>International Harvester : Scout:eBay Motors (item 160383911052 end time  Dec-13-09 18:00:00 PST)</title></head><body>
<div>Bidding has ended on this item.</div><div>${status}</div>
<div>Item Location: Arvada, CO, United States</div><div>A reserve price is the minimum price</div>
<div>Seller info honestsav ( 1085 ) 99% Positive feedback</div><div>Item number: 160383911052</div><div>Item condition: Used</div>
<div>Vehicle History Report Summary for 1977 International Harvester Scout SCOUT 2</div>
<div>Mileage: 121,540 miles</div><div>Location: Arvada, CO</div><div>Vehicle Information</div><div>VIN: G0o6ZGGD11535 | See the free Vehicle History Report</div>
<div id="vv4-40_idiv"><img src="http://i.ebayimg.com/14/!Bgnf~~_35.JPG"></div><table id="vv4-40_tbl"><tr><td id="t_c_vv4-40_0"><img src="http://i.ebayimg.com/14/!Bgnf~~_14.JPG"></td><td id="t_c_vv4-40_1"><img src="http://i.ebayimg.com/24/!BgnY~~_14.JPG"></td></tr></table>
<div id="ngvi_desc_div"><div><p>Runs and drives.</p></div></div>
<script>_r.put('vv4-40_js',new vjo.darwin.core.viewselector1.ViewSelectorWithToolbar({"cmpId":"vv4-40","mnImgData":[{"src":"http://i.ebayimg.com/14/!Bgnf~~_35.JPG"},{"src":"http://i.ebayimg.com/24/!BgnY~~_35.JPG"}],"thImgData":[{"src":"http://i.ebayimg.com/14/!Bgnf~~_14.JPG"},{"src":"http://i.ebayimg.com/24/!BgnY~~_14.JPG"}]}));</script></body></html>`;

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
  const p = parseArchivedItemPage(era2009("Ended: Dec 13, 2009 18:00:00 PST Bid history: 19 bids Winning bid: US $2,050.00"));
  const item = archivedPageToItem(p, "20091215000000", p.images);
  eq([item.legacyItemId, item.itemEndDate, item.bidCount, item.image?.imageUrl], ["160383911052", "2009-12-14T02:00:00.000Z", 19, "https://web.archive.org/web/20091215000000im_/http://i.ebayimg.com/14/!Bgnf~~_35.JPG"]);
  eq(item.localizedAspects?.find((a) => a.name === "Mileage")?.value, "121,540");
});

// Photos, measured 2026-10-20 on 72 archived item pages (64 stored captures 2006-2013, 8 refetched): the item's own photos are
// the ones eBay's photo viewer lists (the 2006-09 slideshow arrays, the 2009-14 view selector's image data, og:image); a store
// logo, a description or template image or another item's picture is anywhere else on the page. eBay photo ids carry ")"
// ("$(KGrHqQOKp!Ey+jC1UHjBN!S6-iv3Q~~", "!BW7wIdw!Wk~$(KGrHgoH-CQEkJwwr(3WBKZ)8hTC6w~~"); a page's photos are not dropped for it.
Deno.test("photos: only the photo viewer's own pictures, every one with ')' in its id, at the largest size listed", () => {
  const html = `<html><head><title>Chevrolet : Bel Air/150/210:eBay Motors (item 230359877867 end time  Aug-01-09 07:29:27 PDT)</title></head><body>
<div>Item number: 230359877867</div>
<a href="http://stores.ebay.com/x" class="store-logo"><img src="http://i.ebayimg.com/00/$T2eC16JHJGIE9nnWpiv1BRS9EMUKBw~~_1.JPG"></a>
<script type="text/javascript"> ss0ImageUrls = descImageUrls = [ [ "http://i.ebayimg.com/04/!BW7wIdw!Wk~$(KGrHgoH-CQEkJwwr(3WBKZ)8hTC6w~~_1.JPG", "http://i.ebayimg.com/04/!BW7wIdw!Wk~$(KGrHgoH-CQEkJwwr(3WBKZ)8hTC6w~~_2.JPG", "http://i.ebayimg.com/04/!BW7wIdw!Wk~$(KGrHgoH-CQEkJwwr(3WBKZ)8hTC6w~~_0.JPG","http://i.ebayimg.com/04/!BW7wIdw!Wk~$(KGrHgoH-CQEkJwwr(3WBKZ)8hTC6w~~_3.JPG" ] , [ "http://i4.ebayimg.com/03/i/001/5b/bc/6070_1.JPG", "http://i4.ebayimg.com/03/i/001/5b/bc/6070_2.JPG", "http://i4.ebayimg.com/03/i/001/5b/bc/6070_0.JPG","http://i4.ebayimg.com/03/i/001/5b/bc/6070_3.JPG" ] ];</script>
<div id="ngvi_desc_div"><img src="http://i.ebayimg.com/t/Dealer-banner/00/$(KGrHqJ,!lsE9JDRuI2(BPqHptyR9w~~_57.JPG"><img src="http://i22.ebayimg.com/07/i/001/11/22/33ab_12.JPG"></div>
<div>Questions and answers about this item</div>
<a href="#ebayphotohosting" onclick="update('http://i.ebayimg.com/04/!BW7wIdw!Wk~$(KGrHgoH-CQEkJwwr(3WBKZ)8hTC6w~~_1.JPG')"><img src="http://i.ebayimg.com/04/!BW7wIdw!Wk~$(KGrHgoH-CQEkJwwr(3WBKZ)8hTC6w~~_0.JPG"></a>
<var>cfg.initialImage = "http://i4.ebayimg.com/03/i/03/11/4d/a2_12_sb.JPG";</var></body></html>`;
  eq(parseArchivedItemPage(html).images, [
    "http://i.ebayimg.com/04/!BW7wIdw!Wk~$(KGrHgoH-CQEkJwwr(3WBKZ)8hTC6w~~_3.JPG",
    "http://i4.ebayimg.com/03/i/001/5b/bc/6070_3.JPG",
  ]);
});

Deno.test("photos: 2010-13 view selector and og:image are the gallery; a page with no photo viewer has no photos", () => {
  const html = `<html><head><title>Lexus : RX in Lexus | eBay Motors</title>
<meta property="og:image" content="http://i.ebayimg.com/00/s/NDgwWDY0MA==/z/LWwAAOxy1klRbWAh/$T2eC16NHJFoE9nh6nPzEBRbW!hbeHw~~60_1.JPG"></head><body>
<a class="store-logo" href="http://stores.ebay.com/x"><img src="http://i.ebayimg.com/00/$T2eC16J,!)EE9s2ufWNFBReWnNUdt!~~_1.JPG"></a>
<div class="merch"><img src="http://i.ebayimg.com/00/s/MTIwMFgxNjAw/z/hw0AAMXQfFJRN8CS/$(KGrHqR,!loFEr1~~60_12.JPG"></div>
<script>new vjo.darwin.core.viewselector1.ViewSelectorWithToolbar({"DE":false,"cmpId":"vv4-36","mnImgData":[{"src":"http://i.ebayimg.com/00/s/NDgwWDY0MA==/z/LWwAAOxy1klRbWAh/$T2eC16NHJFoE9nh6nPzEBRbW!hbeHw~~60_12.JPG"}],"thImgData":[{"src":"http://i.ebayimg.com/00/s/NDgwWDY0MA==/z/LWwAAOxy1klRbWAh/$T2eC16NHJFoE9nh6nPzEBRbW!hbeHw~~60_14.JPG"}]});</script></body></html>`;
  eq(parseArchivedItemPage(html).images, ["http://i.ebayimg.com/00/s/NDgwWDY0MA==/z/LWwAAOxy1klRbWAh/$T2eC16NHJFoE9nh6nPzEBRbW!hbeHw~~60_12.JPG"]);
  eq(parseArchivedItemPage(`<html><body><div>Item number: 120000000001</div><img src="http://i.ebayimg.com/00/$T2eC16J~~_1.JPG"></body></html>`).images, []);
});

// Item 160078932594's 2007 page: the seller pasted an earlier listing's description, and with it that listing's supersize
// slideshow (24 photos of item 250073639703); the stored row set held 47 photos for a 23-photo listing.
Deno.test("photos: another listing's slideshow pasted into the description is not this item's", () => {
  const html = `<html><head><title>Ford : Mustang (item 160078932594 end time Feb-20-07 18:00:00 PST)</title></head><body>
<div>Item number: 160078932594</div>
<a href="http://cgi.ebay.com/ebaymotors/ws/eBayISAPI.dll?ViewItem&amp;item=160078932594&amp;indexURL=0#ebayphotohosting" onclick="update('http://i15.ebayimg.com/07/i/000/87/7a/cf82_3.JPG')"><img src="http://i15.ebayimg.com/07/i/000/87/7a/cf82_0.JPG"></a>
<div id="ngvi_desc_div"><p>Clean car.</p>
<a href="http://cgi.ebay.com/ebaymotors/ws/eBayISAPI.dll?ViewItem&amp;item=250073639703&amp;indexURL=0#ebayphotohosting" onclick="update('http://i22.ebayimg.com/07/i/000/84/b6/f2d1_3.JPG')"><img src="http://i22.ebayimg.com/07/i/000/84/b6/f2d1_0.JPG"></a>
<script> ss0ImageUrls = [ [ "http://i14.ebayimg.com/07/i/000/84/b6/f45b_1.JPG", "http://i14.ebayimg.com/07/i/000/84/b6/f45b_3.JPG" ] ];</script></div>
<div>Questions and answers about this item</div></body></html>`;
  eq(parseArchivedItemPage(html).images, ["http://i15.ebayimg.com/07/i/000/87/7a/cf82_3.JPG"]);
});

// Measured 2026-10-20: of 106 stored photo links GET-probed (76 here, 30 by the scope lane), the Wayback Machine answered
// "has not archived that URL" for every one that answered; the photo viewer's pictures were rarely crawled with the page.
Deno.test("photos land only when the archive serves them: the cover is asked first, and an unarchived cover ends the check", async () => {
  const p = parseArchivedItemPage(era2009("Ended: Dec 13, 2009 18:00:00 PST Bid history: 19 bids Winning bid: US $2,050.00"));
  const asked: string[] = [];
  const none = await archivedPhotos(p.photoSizes, "20091215000000", async (u) => { asked.push(u); return { status: 404, servedTimestamp: null, image: false }; });
  eq([none.held, asked.length, none.checked], [[], 1, 1]);
  eq(archivedPageToItem(p, "20091215000000", none.held).image, undefined);
  const all = await archivedPhotos(p.photoSizes, "20091215000000", async () => ({ status: 200, servedTimestamp: "20091216101010", image: true }));
  eq([all.held.length, all.checked], [2, 2]);
  const item = archivedPageToItem(p, "20091215000000", all.held);
  eq([item.image?.imageUrl, item.additionalImages?.length], ["https://web.archive.org/web/20091215000000im_/http://i.ebayimg.com/14/!Bgnf~~_35.JPG", 1]);
  // a copy the archive took years away from the page is a later picture at that address, not this listing's
  const late = await archivedPhotos(p.photoSizes, "20091215000000", async () => ({ status: 200, servedTimestamp: "20140101000000", image: true }));
  eq(late.held, []);
});

// The two covers the archive served (of 98 vehicles probed 2026-10-20) were the 400px "_1" that og:image names, not the zoom size.
Deno.test("photos: a cover the archive kept only at a smaller size lands at that size; thumbnails are not photos", async () => {
  const html = `<html><head><meta property="og:image" content="http://i.ebayimg.com/00/s/NjAwWDgwMA==/$(KGrHqV,!pcFB(p3gvUCBQWikn1FGw~~60_1.JPG"></head><body>
<script>({"mnImgData":[{"src":"http://i.ebayimg.com/00/s/NjAwWDgwMA==/$(KGrHqV,!pcFB(p3gvUCBQWikn1FGw~~60_3.JPG"}],"thImgData":[{"src":"http://i.ebayimg.com/00/s/NjAwWDgwMA==/$(KGrHqV,!pcFB(p3gvUCBQWikn1FGw~~60_14.JPG"}]})</script></body></html>`;
  const p = parseArchivedItemPage(html);
  eq(p.photoSizes, [["http://i.ebayimg.com/00/s/NjAwWDgwMA==/$(KGrHqV,!pcFB(p3gvUCBQWikn1FGw~~60_3.JPG", "http://i.ebayimg.com/00/s/NjAwWDgwMA==/$(KGrHqV,!pcFB(p3gvUCBQWikn1FGw~~60_1.JPG"]]);
  const r = await archivedPhotos(p.photoSizes, "20130602051408", async (u) => u.endsWith("_1.JPG")
    ? { status: 200, servedTimestamp: "20130523182351", image: true } : { status: 404, servedTimestamp: null, image: false });
  eq([r.held, r.checked], [["http://i.ebayimg.com/00/s/NjAwWDgwMA==/$(KGrHqV,!pcFB(p3gvUCBQWikn1FGw~~60_1.JPG"], 2]);
});

Deno.test("2010-11 sentence-case labels end at the next label; a masked or run-on VIN is dropped", () => {
  const html = `<html><head><title>1977 Toyota Corolla | eBay</title></head><body><h1>1977 Toyota Corolla</h1>
<div>Ended: Mar 18, 2012 19:06:32 PDT Bid history: 12 bids Winning bid: US $9,450.00</div><div>Item number: 120874652371</div><div>Item condition: Used</div>
<div>VIN: XXXXXXX51564213 | See the full History Report</div><div>Mileage: 55,105 miles Hi I am selling my car</div>
<div>For Sale By: Private seller Features Body type: Hatchback Engine: 4 - Cyl. Cylinder Exterior color: Orange Transmission: Manual Fuel type: Gasoline</div></body></html>`;
  const p = parseArchivedItemPage(html);
  eq([p.specifics.Make, p.specifics.Model, p.specifics.Mileage, p.specifics["Body Type"], p.specifics["Exterior Color"], p.specifics.Transmission], ["Toyota", "Corolla", "55,105 miles", "Hatchback", "Orange", "Manual"]);
  const a = Object.fromEntries((archivedPageToItem(p, "20120320000000", []).localizedAspects ?? []).map((x) => [x.name, x.value]));
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

Deno.test("a dealer-template description with early-closing divs is read to eBay's next section", () => {
  const html = `<html><head><title>Toyota : Land Cruiser FJ40 in Toyota | eBay Motors</title></head><body><h1>1977 Toyota Land Cruiser FJ40</h1>
<div>Ended: Feb 28, 2013 15:49:08 PST Sold For: US $29,750.00</div><div>Item number: 380581917878</div>
<div id="ngvi_desc_div" class="d-pad"><div><div><table><tr><td></td></tr></table></div></div><style>.x{margin:0}</style>
<p>Frame-off restoration, 11,000 miles since.</p><div><p>Original 2F engine.</p></div></div></div>
<div>Questions and answers about this item</div><div>Back to home page</div></body></html>`;
  eq(parseArchivedItemPage(html).description, "Frame-off restoration, 11,000 miles since. Original 2F engine.");
});

// Title tags of captures from 2010-11 read "Ferrari : 308 - eBay (item 290519586058 end time  Jan-26-11 08:21:47 PST)"; 704 of the
// 18,039 rows landed in the 24 hours to 2026-10-20 05:30Z carried the site's name in their model ("308 - eBay", "Mustang - eBay").
Deno.test("a 2010-11 title tag's ' - eBay' site suffix is the site's name, not part of the model", () => {
  const html = `<html><head><title>Ferrari : 308 - eBay (item 290519586058 end time  Jan-26-11 08:21:47 PST)</title></head><body>
<div>Ended: Jan 26, 2011 08:21:47 PST Bid history: 3 bids Current bid: US $20,100.00 Reserve not met</div><div>Item number: 290519586058</div></body></html>`;
  const p = parseArchivedItemPage(html, "http://cgi.ebay.com:80/ebaymotors/1978-Ferrari-308-GTS-Low-Miles-/290519586058?");
  eq([p.specifics.Year, p.specifics.Make, p.specifics.Model, p.title], ["1978", "Ferrari", "308", "Ferrari : 308"]);
  const motors = parseArchivedItemPage(html.replace("308 - eBay", "Mustang - eBay Motors"));
  eq([motors.specifics.Make, motors.specifics.Model], ["Ferrari", "Mustang"]);
});

Deno.test("the year comes from two-digit and make-first URL slugs when the page prints none", () => {
  eq(slugYear("http://cgi.ebay.com:80/ebaymotors/1965-65-Barn-Find-389-4-speed-Pontiac-GTO_W0QQitemZ1"), "1965");
  eq(slugYear("http://cgi.ebay.com:80/ebaymotors/68-Charger-RT-barn-find-numbers-matching-/2903"), "1968");
  eq(slugYear("http://cgi.ebay.com:80/ebaymotors/Chevrolet-Camaro-1969-RS-CAMARO-CONVERTIBLE-/1"), "1969");
  eq(slugYear("http://cgi.ebay.com:80/ebaymotors/AUTOMATIC-SPORT-STYLE-CHROME-SHIFTER-/1"), undefined);
  const html = `<html><head><title>Dodge : Charger:eBay Motors (item 290303659996 end time Mar-10-09 18:00:00 PDT)</title></head><body>
<div>Ended: Mar 10, 2009 18:00:00 PDT Bid history: 22 bids Winning bid: US $21,100.00</div><div>Item number: 290303659996</div></body></html>`;
  const p = parseArchivedItemPage(html, "http://cgi.ebay.com:80/ebaymotors/68-Charger-RT-barn-find-numbers-matching-rare-440_W0QQitemZ290303659996");
  eq([p.specifics.Year, p.specifics.Make, p.specifics.Model], ["1968", "Dodge", "Charger"]);
});
