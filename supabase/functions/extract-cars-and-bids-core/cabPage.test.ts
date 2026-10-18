import { balanced, cabCapturePredatesResult, cabLotPhotos, cabOtherLotPhotoKeys, cabPhotoSet, decode, easternToIso, parseCabDepth, parseEnd } from "./cabPage.ts";

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

Deno.test("entities decode in one pass", () => eq(decode("a &amp;lt; b &amp; c &#39;d&#39;"), "a &lt; b & c 'd'"));

Deno.test("balanced keeps nested divs", () => {
  const h = '<div class="a">x<div>y</div>z</div><div>after</div>';
  eq(balanced(h, 0), "x<div>y</div>z");
});

Deno.test("eastern wall time becomes UTC across DST", () => {
  eq(easternToIso("October 13, 2026 @ 10:16 PM"), "2026-10-14T02:16:00.000Z");
  eq(easternToIso("February 11, 2026 @ 2:14 PM"), "2026-02-11T19:14:00.000Z");
});

Deno.test("end phrase reads zone and year", () => {
  eq(parseEnd("Ended February 11th at 2:14 PM EST", "2/11/26", new Date("2026-10-15T00:00:00Z")), "2026-02-11T19:14:00.000Z");
  eq(parseEnd("Ending October 16th at 2:21 PM EDT", null, new Date("2026-10-15T00:45:00Z")), "2026-10-16T18:21:00.000Z");
});

const page = (stats: string) => `<div class="gallery-preview"><img src="https://media.carsandbids.com/cdn-cgi/image/width=542,quality=70/h/photos/a/b.jpg?t=1"></div>` +
  `<div class="auction-bidbar"><div class="bid-bar  ended"><ul class="bid-stats">${stats}</ul></div></div><p class="end-time">Ended February 11th at 2:14 PM EST</p>` +
  `<dd class="seller"><div class="username"><a class="user" href="https://carsandbids.com/user/sam">sam</a></div></dd>` +
  `<div class="detail-section detail-highlights"><h4>Highlights</h4><div class="detail-body"><p>one</p><div><p>two</p></div></div></div>` +
  `<div class="cnb-details-comments"><ul><li data-id="c1" id="comment-c1" class="comment "><div class="username"><a class="user" href="https://carsandbids.com/user/amy">amy</a><span class="time" data-full="x" title="February 11, 2026 @ 1:00 PM"></span></div><div class="content"><div class="message"><p>Nice <b>car</b>?</p></div><div class="interact"><button class="btn btn-upvote"><svg></svg>3</button></div></div></li></ul></div>`;

Deno.test("sold page: outcome, price, description, seller, comment and photo", () => {
  const d = parseCabDepth(page('<li class="ended"><span class="value">Sold for <span class="bid-value">$16,250</span></span></li><li class="time"><span class="value"><span class="time-ended">2/11/26</span></span></li>'), new Date("2026-10-15T00:00:00Z"));
  eq([d.outcome, d.amount, d.endedAt, d.seller?.name], ["sold", 16250, "2026-02-11T19:14:00.000Z", "sam"]);
  eq(d.sections[0].text, "one\ntwo");
  eq([d.comments.length, d.comments[0].author, d.comments[0].text, d.comments[0].likes, d.comments[0].postedAt], [1, "amy", "Nice car?", 3, "2026-02-11T18:00:00.000Z"]);
  eq(d.photos, ["https://media.carsandbids.com/cdn-cgi/image/width=2080,quality=70/h/photos/a/b.jpg"]);
});

Deno.test("ended without Sold for is not a sale", () => {
  const d = parseCabDepth(page('<li class="ended"><span class="value">High Bid <span class="bid-value">$9,000</span></span></li><li>Reserve Not Met</li>'), new Date("2026-10-15T00:00:00Z"));
  eq([d.outcome, d.amount], ["reserve_not_met", 9000]);
});

Deno.test("a retained pre-close live frame cannot replace a known ended result", () => {
  const captured = "2026-07-27T18:02:54.148Z";
  const end = "2026-07-29T18:41:02.745Z";
  const live = parseCabDepth(page('<li><span class="bid-value">$9,000</span></li>').replace('bid-bar  ended', 'bid-bar active'), new Date(captured));
  eq(live.outcome, "active");
  for (const auction_status of ["sold", "ended", "reserve_not_met"]) {
    eq(cabCapturePredatesResult(captured, live.outcome, { auction_status, auction_end_date: end }), true);
  }
  eq(cabCapturePredatesResult(end, live.outcome, { auction_status: "sold", auction_end_date: end }), true);
});

Deno.test("final captures, current live lots and newer contradictory captures keep their existing path", () => {
  const end = "2026-07-29T18:41:02.745Z";
  const prior = { auction_status: "sold", auction_end_date: end };
  const sold = parseCabDepth(page('<li class="ended">Sold for <span class="bid-value">$16,250</span></li>'), new Date("2026-07-30T00:00:00Z"));
  eq(cabCapturePredatesResult("2026-07-30T00:00:00Z", sold.outcome, prior), false);
  eq(cabCapturePredatesResult("2026-07-27T00:00:00Z", "active", { ...prior, auction_status: "active" }), false);
  eq(cabCapturePredatesResult("2026-07-30T00:00:00Z", "active", prior), false);
  eq(cabCapturePredatesResult("2026-07-27T00:00:00Z", "active", {}), false);
});

Deno.test("unknown capture/end clocks do not invent a chronological conflict", () => {
  for (const clock of [null, undefined, "invalid"]) {
    eq(cabCapturePredatesResult(clock, "active", { auction_status: "sold", auction_end_date: "2026-07-29T00:00:00Z" }), false);
    eq(cabCapturePredatesResult("2026-07-27T00:00:00Z", "active", { auction_status: "sold", auction_end_date: clock }), false);
  }
});

// Shaped like the retained 92xXv4Oa capture (2026-07-27): the lot's gallery shares set 3yvlj0Do; the rails below the comments
// are links to other auctions with their own 768, 356x260 and 148x126 renders, some with seller-named files and no set id.
const M = "https://media.carsandbids.com/cdn-cgi/image";
const img = (opts: string, path: string) => `<img src="${M}/${opts}/9004/photos/${path}?t=1">`;
const card = (lot: string, ...imgs: string[]) =>
  `<li class="auction-item"><div class="LazyLoad"><a class="hero" title="Other" href="https://carsandbids.com/auctions/${lot}/other-car"><div class="preload-wrap">${imgs.join("")}</div></a></div></li>`;
const lotPage = (rails: string, bidbarAfterRails = false) =>
  `<div class="row auction-photos"><div class="gallery-preview"><div class="preload-wrap main">${img("width=2080,quality=70", "3yvlj0Do-EpLCSxj/edit/jAdnL.jpg")}</div>` +
  `<div class="images">${img("width=542,quality=70", "3yvlj0Do-MIQ9Hac/edit/wgwPO.jpg")}${img("width=542,quality=70", "exterior/3yvlj0Do--qXdYyQ/edit/6hJFo.jpg")}</div></div>` +
  (bidbarAfterRails ? "" : `<div class="auction-bidbar"></div>`) +
  `<a class="share" href="https://carsandbids.com/auctions/92xXv4Oa/1997-bmw-m3-coupe">${img("width=768,quality=70", "3yvlj0Do-EpLCSxj/edit/jAdnL.jpg")}</a>` +
  `<div class="cnb-details-comments"><img src="${M}/width=80,height=80,quality=70,fit=cover/abc/photos/3yE6VOR3-UVVWTo8ijAT.jpg">` +
  `<img src="${M}/width=180,quality=70/e0b9/attachments/92xXv4Oa-yp5UNAF.jpeg"></div>` +
  `<div class="sidebar"><h5>Ending soon</h5><ul class="side-auctions-list">${rails}</ul></div>` +
  (bidbarAfterRails ? `<div class="auction-bidbar"></div>` : "");
const rails =
  card("9eeZzWwg", img("width=768,quality=70", "30xvA242-TnXslZ7/edit/oaDat.jpg")) +
  card("9lZk64MG", img("width=768,quality=70", "SubaruBaja2006008/edit/te_Gl.jpg")) +
  card("r4D1dzGL", img("width=356,height=260,quality=70", "exterior/KmmMMmlY-vPv9eC8/edit/yPjdT.jpg"),
    img("width=148,height=126,quality=70", "interior/KmmMMmlY-u-GbNEF/edit/s7ovF.jpg")) +
  card("3Blv7vAE", img("width=356,height=260,quality=70", "application/s-na2z0u9/edit/d3_Rb.jpg"));
const keyOf = (u: string) => u.replace(/^.*\/photos\//, "").split("?")[0];

Deno.test("photo set id is the listing's gallery prefix; seller-named files have none", () => {
  eq(cabPhotoSet(`${M}/width=542,quality=70/h/photos/exterior/3yvlj0Do--qXdYyQ/edit/6hJFo.jpg`), "3yvlj0Do");
  eq(cabPhotoSet(`${M}/width=768,quality=70/h/photos/30xvA242-TnXslZ7/edit/oaDat.jpg`), "30xvA242");
  eq([cabPhotoSet(`${M}/width=768/h/photos/SubaruBaja2006008/edit/x.jpg`), cabPhotoSet(`${M}/width=768/h/photos/application/s-na2z0u9/edit/x.jpg`)], [null, null]);
});

Deno.test("cards linking to other auctions are other lots; a link to this lot is not", () => {
  const html = lotPage(rails);
  eq([...cabOtherLotPhotoKeys(html, "92xXv4Oa")].map((k) => k.replace(/^.*\/photos\//, "")).sort(),
    ["30xvA242-TnXslZ7/edit/oaDat.jpg", "SubaruBaja2006008/edit/te_Gl.jpg", "application/s-na2z0u9/edit/d3_Rb.jpg",
      "exterior/KmmMMmlY-vPv9eC8/edit/yPjdT.jpg", "interior/KmmMMmlY-u-GbNEF/edit/s7ovF.jpg"]);
});

Deno.test("page photos are the lot's own: gallery and its set, never the other lots' cards", () => {
  const got = cabLotPhotos(lotPage(rails), "92xXv4Oa").map(keyOf);
  eq(got, ["3yvlj0Do-EpLCSxj/edit/jAdnL.jpg", "3yvlj0Do-MIQ9Hac/edit/wgwPO.jpg", "exterior/3yvlj0Do--qXdYyQ/edit/6hJFo.jpg"]);
});

Deno.test("without a gallery no page photo is taken as the lot's", () => {
  eq(cabLotPhotos(lotPage(rails).replace("gallery-preview", "gallery-gone"), "92xXv4Oa"), []);
});

Deno.test("gallery reader drops cards even when the bid bar comes after the rails", () => {
  for (const late of [false, true]) {
    const d = parseCabDepth(lotPage(rails, late), new Date("2026-10-15T00:00:00Z"), "92xXv4Oa");
    eq(d.photos.map(keyOf), ["3yvlj0Do-EpLCSxj/edit/jAdnL.jpg", "3yvlj0Do-MIQ9Hac/edit/wgwPO.jpg", "exterior/3yvlj0Do--qXdYyQ/edit/6hJFo.jpg"]);
    eq(d.photos.every((u) => u.includes("/cdn-cgi/image/width=2080,quality=70/")), true);
  }
});
