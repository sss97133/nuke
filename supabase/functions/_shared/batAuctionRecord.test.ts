// deno test supabase/functions/_shared/batAuctionRecord.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { countdownEndDate, readCommentsJson, readOwnAuctionEnd, summarizeAuction, vinCheckDigitOk, buildAuctionCommentRows, linkAuctionCommentIdentities, type BatCommentIdentityStore } from "./batAuctionRecord.ts";

// Shapes copied from real lot pages (2026-09-27): each comment carries nested channels/likers/images
// arrays, which is what defeats a lazy "comments":[...] regex.
const bid = (author: string, amount: number, ts: number, type = "bat-bid") => ({
  channels: ["a", ["nested", "arrays"]], likers: [{ id: 1, tags: [] }], images: [], videos: [],
  authorName: author, authorId: 1, id: ts, likes: 0, type, bidAmount: amount, timestamp: ts,
  content: `USD $${amount.toLocaleString("en-US")} bid placed by ${author}`,
});
const record = (type: string, author: string, content: string, ts: number) => ({
  channels: [], likers: [], images: [], authorName: author, authorId: 0, id: ts, type, bidAmount: 0, timestamp: ts, content,
});
const page = (comments: unknown[]) =>
  `<html><script>var x = {"listing":{"title":"1983 Chevrolet K10 4x4"},"comments":${JSON.stringify(comments)},"other":[1,2]};</script>` +
  `<div class="comment"><a href="#">"comments":[not json]</a></div></html>`;

Deno.test("bracket reader returns the full comments array despite nested arrays", () => {
  const html = page([bid("a", 100, 1), bid("b", 200, 2), record("bat-bid-reserve", "b", "Sold on 1/28/23 for $200 to b", 3)]);
  const arr = readCommentsJson(html);
  assertEquals(arr?.length, 3);
});

Deno.test("plain sale: price and buyer from the sale record, high bid from live bids", () => {
  const r = summarizeAuction(page([
    bid("hellyan999", 16750, 1674938221), bid("Matsu71", 17000, 1674938250),
    record("bat-bid-reserve", "Matsu71", "Sold on 1/28/23 for $17,000 to Matsu71", 1674938402),
  ]));
  assertEquals(r.parsed, true);
  assertEquals(r.sold, true);
  assertEquals(r.soldAfterReserveNotMet, false);
  assertEquals(r.saleAmount, 17000);
  assertEquals(r.buyer, "Matsu71");
  assertEquals(r.highBid, 17000);
  assertEquals(r.bidCount, 2);
  assertEquals(r.uniqueBidders, 2);
  assertEquals(r.recordAt, "2023-01-28T20:40:02.000Z");
});

Deno.test("reserve not met: no price, no buyer, high bid kept", () => {
  const r = summarizeAuction(page([
    bid("dhood4880", 51000, 1780336502), bid("jose-resendiz", 51500, 1780336550),
    record("bat-bid-reserve", "Anonymous", "Reserve not met on 6/1/26 at USD $51,500", 1780336670),
  ]));
  assertEquals(r.sold, false);
  assertEquals(r.saleAmount, null);
  assertEquals(r.buyer, null);
  assertEquals(r.reserveNotMet, true);
  assertEquals(r.reserveNotMetAmount, 51500);
  assertEquals(r.highBid, 51500);
});

Deno.test("sold after reserve not met: the record's price beats the high bid (catalog carries the bid)", () => {
  const r = summarizeAuction(page([
    bid("Toolguys", 22250, 1744398843), bid("nocera76", 23000, 1744398959),
    record("bat-bid-reserve", "Anonymous", "Reserve not met on 4/11/25 at USD $23,000", 1744399079),
    record("bat-rnm-accepted", "nocera76", "Sold on 04/11/2025 for $24,000 to nocera76", 1744420963),
  ]));
  assertEquals(r.sold, true);
  assertEquals(r.soldAfterReserveNotMet, true);
  assertEquals(r.saleAmount, 24000);
  assertEquals(r.buyer, "nocera76");
  assertEquals(r.highBid, 23000);
  assertEquals(r.reserveNotMet, true);
});

Deno.test("canceled bids never count as bids or as the high bid", () => {
  const r = summarizeAuction(page([
    bid("cbates6798", 40000, 1747327108, "bat-bid-canceled"),
    record("bat-bid-canceled", "cbates6798", "The bid of USD $40,000 was canceled by BaT", 1747339486),
    bid("ryanyferguson", 50050, 1747432774), bid("ColtonM", 50550, 1747432875),
    record("bat-bid-reserve", "Anonymous", "Reserve not met on 5/16/25 at USD $50,550", 1747432996),
  ]));
  assertEquals(r.hadCanceledBids, true);
  assertEquals(r.bidCount, 2);
  assertEquals(r.highBid, 50550);
  assertEquals(r.sold, false);
});

Deno.test("no comments JSON on the page → not parsed, nothing asserted", () => {
  const r = summarizeAuction("<html><body>live auction, comments load later</body></html>");
  assertEquals(r.parsed, false);
  assertEquals(r.sold, false);
  assertEquals(r.highBid, null);
});

Deno.test("VIN check digit: valid, invalid, and pre-1981 (not judged)", () => {
  assertEquals(vinCheckDigitOk("1GCEK14L9EJ147915"), true);   // the White K10
  assertEquals(vinCheckDigitOk("1GCEK14L8EJ147915"), false);  // one digit off
  assertEquals(vinCheckDigitOk("1gcek14l9ej147915"), true);   // case-insensitive
  assertEquals(vinCheckDigitOk("1GCEK14L9EJ14791O"), false);  // O is not a VIN character
  assertEquals(vinCheckDigitOk("CKR147F398693"), null);       // 13-char pre-1981 GM VIN: no check digit exists
  assertEquals(vinCheckDigitOk(null), null);
});

const commentRows = (rawComments: unknown[]) => buildAuctionCommentRows({
  rawComments, vehicleId: "vehicle", auctionEventId: "event",
  listingUrlNorm: "https://bringatrailer.com/listing/test/", endAt: new Date("2026-01-01T00:00:00Z"),
});

Deno.test("identity links preserve testimony/hash, seller normalization, exact case, and existing keys on replay", async () => {
  const rows = await commentRows([
    bid("AndrewB55", 100, 1), bid("AndrewB55 (The Seller)", 200, 2), bid("andrewb55", 300, 3),
    record("bat-bid-reserve", "Anonymous", "Reserve not met", 4), record("comment", "", "image-only", 5),
  ]);
  const before = structuredClone(rows);
  const ids = new Map([["AndrewB55", "existing-id"]]);
  const created: string[] = [];
  const store: BatCommentIdentityStore = {
    find: async (handles) => handles.filter((h) => ids.has(h)).map((handle) => ({ handle, id: ids.get(handle)! })),
    insertMissing: async (identities) => {
      for (const r of identities) {
        assertEquals(r.platform, "bat");
        assertEquals(r.profile_url, `https://bringatrailer.com/member/${encodeURIComponent(r.handle)}`);
        created.push(r.handle);
        ids.set(r.handle, "new-id");
      }
    },
  };
  const linked = await linkAuctionCommentIdentities(rows, store);
  assertEquals(linked.map((r) => r.external_identity_id), ["existing-id", "existing-id", "new-id", null, null]);
  assertEquals(linked.map(({ external_identity_id: _, ...testimony }) => testimony), before);
  assertEquals(rows, before);
  assertEquals(await linkAuctionCommentIdentities(rows, store), linked);
  assertEquals(created, ["andrewb55"]);
});

Deno.test("identity insert races use the winner's key and public profile URLs encode punctuation", async () => {
  const rows = await commentRows([bid('driver,+"\\ /', 100, 1)]);
  let inserted = false;
  const linked = await linkAuctionCommentIdentities(rows, {
    find: async () => inserted ? [{ handle: rows[0].author_username, id: "concurrent-winner" }] : [],
    insertMissing: async (identities) => {
      assertEquals(identities[0].profile_url, 'https://bringatrailer.com/member/driver%2C%2B%22%5C%20%2F');
      inserted = true;
    },
  });
  assertEquals(linked[0].external_identity_id, "concurrent-winner");
});

Deno.test("501 distinct authors use bounded batches; repeated authors need no extra lookup", async () => {
  const rows = await commentRows(Array.from({ length: 1002 }, (_, i) => bid(`user-${i % 501}`, 100, i + 1)));
  const batches: number[] = [];
  const linked = await linkAuctionCommentIdentities(rows, {
    find: async (handles) => { batches.push(handles.length); return handles.map((handle) => ({ handle, id: handle })); },
    insertMissing: async () => { throw new Error("Existing identities must not be rewritten"); },
  });
  assertEquals(batches, [200, 200, 101]);
  assertEquals(linked.filter((r) => r.external_identity_id).length, 1002);
});

Deno.test("failed or incomplete identity resolution stops disconnected comment insertion", async () => {
  const rows = await commentRows([bid("driver", 100, 1)]);
  await assertRejects(() => linkAuctionCommentIdentities(rows, {
    find: async () => { throw new Error("database unavailable"); }, insertMissing: async () => {},
  }), Error, "database unavailable");
  await assertRejects(() => linkAuctionCommentIdentities(rows, {
    find: async () => [], insertMissing: async () => { throw new Error("insert refused"); },
  }), Error, "insert refused");
  await assertRejects(() => linkAuctionCommentIdentities(rows, {
    find: async () => [], insertMissing: async () => {},
  }), Error, "incomplete after insert");
});

Deno.test("anonymous authors are never keyed, even with an author id; Unknown stays null; named handles are keyed", async () => {
  // Same rule as trg_key_auction_comment_author / key_auction_comment_authors (20261006090000).
  const rows = await commentRows([
    bid("driver", 100, 1),
    { ...bid("anonymous", 200, 2), authorId: 777 },
    { ...bid("ANONYMOUS", 300, 3), authorId: 778 },
    { ...record("comment", "", "image-only, author blank", 4), authorId: 779 },
  ]);
  assertEquals(rows.map((r) => [r.author_username, r.bat_author_id]),
    [["driver", 1], ["anonymous", 777], ["ANONYMOUS", 778], ["Unknown", 779]]);
  const looked: string[] = [];
  const minted: string[] = [];
  const linked = await linkAuctionCommentIdentities(rows, {
    find: async (handles) => { looked.push(...handles); return handles.filter((h) => h === "driver").map((handle) => ({ handle, id: "driver-id" })); },
    insertMissing: async (identities) => { minted.push(...identities.map((i) => i.handle)); },
  });
  assertEquals(linked.map((r) => r.external_identity_id), ["driver-id", null, null, null]);
  assertEquals(looked, ["driver"]);   // anonymous and Unknown are never looked up
  assertEquals(minted, []);           // and never minted
});

Deno.test("replay with no fresh rows never touches the identity store", async () => {
  const linked = await linkAuctionCommentIdentities([], {
    find: async () => { throw new Error("No reads expected"); },
    insertMissing: async () => { throw new Error("No writes expected"); },
  });
  assertEquals(linked, []);
});

// 2026-10-15: a closed "-2" repeat lot (1970-porsche-914-6-110-2, sold 10/14/26) was stamped with 2026-10-15, the
// end of a LIVE lot in its sidebar (data-auction-ends="2026-10-15-17-00-00"), because the closed page has no countdown.
const sidebar = `<div data-auction-ends="2026-10-15-17-00-00" data-layout="{hn}"></div>`;
Deno.test("countdownEndDate: a closed '-2' relist page ignores a sidebar lot's countdown", () => {
  const closed = page([bid("m1959", 61000, 1792009000), record("bat-bid-reserve", "m1959", "Sold on 10/14/26 for $67,000 to m1959", 1792009681)]) + sidebar;
  assertEquals(summarizeAuction(closed).recordAt, "2026-10-14T20:28:01.000Z");
  assertEquals(countdownEndDate(closed), null);
});

Deno.test("countdownEndDate: a live page reads its own countdown", () => {
  const live = page([bid("a", 100, 1792000000)]) + `<div data-auction-ends="2026-10-17-19-08-57"></div>` + sidebar;
  assertEquals(countdownEndDate(live), "2026-10-17");
});

// Shapes copied from two lot pages read 2026-10-15: a running GT2 RS (post 121897619) and a closed 911 C4S
// cabriolet that sold 2026-05-26 (post 113602346). Both carry the "Current BaT Auctions" widget.
const widget = `<div class="widget bat-listings-widget-current-auctions"><div class="current-auctions group">
  <div class="current-auction-data-time">Ends in:<br /><span data-auction-ends-id="121897619" data-auction-ends="2026-10-15-17-00-00" data-layout="{hn} {hl}, {mn} {ml}"></span></div>
  <div class="current-auction-data-time">Ends in:<br /><span data-auction-ends-id="122860945" data-auction-ends="2026-10-15-17-05-00" data-layout="{hn} {hl}, {mn} {ml}"></span></div>
</div></div>`;
const runningPage = `<head><link rel='shortlink' href='https://bringatrailer.com/?p=121897619' /></head>
<div class="listing-available-info">
  <span data-listing-currently="121897619"><span class="info-label">Current Bid:</span> <strong class="info-value">USD $601,000</strong></span><span class="info-label">Ends in</span><strong class="info-value noborder-tiny"><span class="listing-available-countdown" data-countdown="121897619" data-until="1792083600"></span><span class="listing-end-processing-notice">Checking for last second bids...</span></strong><a class="comments-anchor-link" href="#comments-anchor"></a>
</div>
<td class="listing-stats-value"><span class="listing-end-time date-localize" data-auction-ends-id="121897619" data-auction-ends="2026-10-15-17-00-00" data-timestamp="1792083600" data-format="L"></span></td>
<td class="listing-stats-value"><span class="date-localize" data-ends="1792083600" data-ends-id="121897619" data-timestamp="1792083600"></span></td>
${widget}`;
const closedPage = `<head><link rel='shortlink' href='https://bringatrailer.com/?p=113602346' /></head>
${widget}
<div class="listing-available-info">
  <span data-listing-currently="113602346"></span><span class="info-value noborder-tiny">Sold for <strong>USD $100,000</strong> <span class="date date-localize" data-timestamp="1779828177" data-format="L">on 5/26/26</span></span><a class="comments-anchor-link" href="#comments-anchor"></a>
</div>`;

Deno.test("own end: a running lot's own countdown, not the widget's first entry", () => {
  assertEquals(readOwnAuctionEnd(runningPage), {
    postId: "121897619", endsAt: "2026-10-15T17:00:00.000Z", endsDate: "2026-10-15", endsFrom: "data-ends", closedAt: null, withdrawn: false,
  });
});

Deno.test("own end: a closed page has no countdown of its own; its result stamp is the close", () => {
  // the first data-auction-ends on this page is another lot's (2026-10-15); the lot sold 2026-05-26
  assertEquals(readOwnAuctionEnd(closedPage), {
    postId: "113602346", endsAt: null, endsDate: null, endsFrom: null, closedAt: "2026-05-26T20:42:57.000Z", withdrawn: false,
  });
});

Deno.test("own end: the countdown fallback counts only with the page's own id", () => {
  const ownCountdownOnly = runningPage.replace(/<td class="listing-stats-value"><span class="date-localize" data-ends[^\n]*\n/, "");
  assertEquals(readOwnAuctionEnd(ownCountdownOnly).endsFrom, "countdown");
  assertEquals(readOwnAuctionEnd(ownCountdownOnly).endsAt, "2026-10-15T17:00:00.000Z");
  // no shortlink and no result line: no post id, so no countdown is anyone's own
  assertEquals(readOwnAuctionEnd(widget), { postId: null, endsAt: null, endsDate: null, endsFrom: null, closedAt: null, withdrawn: false });
  // the closed "-2" relist of #1574: a sidebar countdown with no id is nobody's own
  assertEquals(readOwnAuctionEnd(sidebar).endsDate, null);
  // another lot's data-ends (an id that is not the page's) is not this lot's end
  const foreign = closedPage + `<span data-ends="1792083600" data-ends-id="121897619"></span>`;
  assertEquals(readOwnAuctionEnd(foreign).endsAt, null);
});

// Shape copied from 1955-volkswagen-beetle-deluxe (post 123323130), withdrawn 10/5/26 and read 2026-10-15: no countdown
// of its own, the widget's countdowns, and a result line whose stamp span is "info-value noborder-tiny date-localize".
const withdrawnPage = `<head><link rel='shortlink' href='https://bringatrailer.com/?p=123323130' /></head>
${widget}
<div class="listing-available-info">
  <span data-listing-currently="123323130"></span><span class="info-label">Withdrawn on</span><span class="info-value noborder-tiny date-localize" data-timestamp="1791231660" data-format="L">10/5/26</span><a class="comments-anchor-link" href="#comments-anchor"></a>
</div>`;

Deno.test("own end: a withdrawn page is closed at its 'Withdrawn on' stamp", () => {
  assertEquals(readOwnAuctionEnd(withdrawnPage), {
    postId: "123323130", endsAt: null, endsDate: null, endsFrom: null, closedAt: "2026-10-05T20:21:00.000Z", withdrawn: true,
  });
  // a sold page's stamp is not a withdrawal
  assertEquals(readOwnAuctionEnd(closedPage).withdrawn, false);
});
