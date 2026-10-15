import { balanced, decode, easternToIso, parseCabDepth, parseEnd } from "./cabPage.ts";

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
