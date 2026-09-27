// deno test supabase/functions/_shared/batAuctionRecord.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readCommentsJson, summarizeAuction, vinCheckDigitOk } from "./batAuctionRecord.ts";

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
