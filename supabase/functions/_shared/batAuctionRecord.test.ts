// deno test supabase/functions/_shared/batAuctionRecord.test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readCommentsJson, summarizeAuction, vinCheckDigitOk, buildAuctionCommentRows, linkAuctionCommentIdentities, type BatCommentIdentityStore } from "./batAuctionRecord.ts";

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
