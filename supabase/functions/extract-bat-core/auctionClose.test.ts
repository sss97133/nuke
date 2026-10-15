// deno test supabase/functions/extract-bat-core/auctionClose.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { auctionClose, planEndRows, writtenBeforeItsEnd, END_SETTLE_MS, type EndRow } from "./auctionClose.ts";

const END = "2026-10-15T17:00:00.000Z";
const after = (ms: number) => new Date(Date.parse(END) + ms).toISOString();
const none = { hasSale: false, recordClosed: false };

Deno.test("a running lot is not over: its end is ahead of the page's read clock", () => {
  // the live 911 Carrera 4S of 2026-10-15: read at 13:55Z, ending at 17:00Z, bid $250,000
  assertEquals(auctionClose({ ...none, endAt: END, readAt: "2026-10-15T13:55:00Z" }), { over: false, basis: "running" });
  // the countdown just ran out: "Checking for last second bids...", no result yet
  assertEquals(auctionClose({ ...none, endAt: END, readAt: after(60_000) }), { over: false, basis: "running" });
});

Deno.test("over: a sale, the closing record, or an end settled before the read", () => {
  assertEquals(auctionClose({ ...none, hasSale: true, endAt: END, readAt: "2026-10-15T13:55:00Z" }).basis, "sale");
  assertEquals(auctionClose({ ...none, recordClosed: true, endAt: null, readAt: null }).basis, "auction_record");
  assertEquals(auctionClose({ ...none, endAt: END, readAt: after(END_SETTLE_MS) }), { over: true, basis: "end_passed" });
});

Deno.test("no end or no read clock: not over (unknown), never judged against the extraction time", () => {
  assertEquals(auctionClose({ ...none, endAt: null, readAt: after(0) }), { over: false, basis: "unknown" });
  // a snapshot with no fetch clock, of a lot that has long since ended
  assertEquals(auctionClose({ ...none, endAt: "2026-01-01T00:00:00Z", readAt: null }), { over: false, basis: "unknown" });
});

const row = (id: string, event_type: string, event_date: string, created_at: string, metadata: Record<string, any> = {}): EndRow =>
  ({ id, event_type, event_date, created_at, metadata });

Deno.test("written before its end: data-ends when recorded, else the end's day", () => {
  assertEquals(writtenBeforeItsEnd(row("a", "auction_ended", "2026-10-15", "2026-10-07T09:00:00Z")), true);
  assertEquals(writtenBeforeItsEnd(row("b", "auction_ended", "2026-10-15", "2026-10-15T09:00:00Z",
    { occurred_at: END, occurred_at_source: "data-ends" })), true);       // same day, hours before the close
  assertEquals(writtenBeforeItsEnd(row("c", "auction_ended", "2026-10-15", "2026-10-15T09:00:00Z")), false); // day only: unknown, kept
  assertEquals(writtenBeforeItsEnd(row("d", "auction_ended", "2026-10-15", after(3_600_000),
    { occurred_at: END, occurred_at_source: "data-ends" })), false);
  assertEquals(writtenBeforeItsEnd(row("e", "auction_sold", "2026-10-15", "2026-10-07T09:00:00Z")), false); // results are never "live"
});

Deno.test("the sale replaces the live-written end row; a reserve-not-met result is never retired", () => {
  const live = row("live", "auction_ended", "2026-10-15", "2026-10-07T09:00:00Z", { occurred_at: END, occurred_at_source: "data-ends" });
  const rnm = row("rnm", "auction_reserve_not_met", "2026-10-15", after(120_000));
  const plan = planEndRows([live, rnm], { eventType: "auction_sold", eventDate: "2026-10-15" });
  assertEquals(plan.keepId, null);                                  // insert the sold row
  assertEquals(plan.retire.map((r) => r.id), ["live"]);
});

Deno.test("a lot that ended unsold: the live row with the scheduled day and mid-auction bid is replaced, not kept", () => {
  const live = row("live", "auction_ended", "2026-10-15", "2026-10-15T09:00:00Z", { occurred_at: END, occurred_at_source: "data-ends" });
  const plan = planEndRows([live], { eventType: "auction_ended", eventDate: "2026-10-15" });
  assertEquals(plan.keepId, null);
  assertEquals(plan.retire.map((r) => r.id), ["live"]);
});

Deno.test("re-reading a closed lot is a no-op; an ended row on another day or beside the result goes", () => {
  const closed = row("closed", "auction_ended", "2026-10-15", after(3_600_000), { occurred_at: END, occurred_at_source: "data-ends" });
  assertEquals(planEndRows([closed], { eventType: "auction_ended", eventDate: "2026-10-15" }), { keepId: "closed", retire: [] });
  const otherDay = row("other", "auction_ended", "2026-10-16", "2026-10-15T21:00:00Z");     // dated by another lot's countdown
  assertEquals(planEndRows([closed, otherDay], { eventType: "auction_ended", eventDate: "2026-10-15" }).retire.map((r) => r.id), ["other"]);
  const sold = row("sold", "auction_sold", "2026-10-15", after(600_000));
  assertEquals(planEndRows([sold, closed], { eventType: "auction_sold", eventDate: "2026-10-15" }), { keepId: "sold", retire: [closed] });
});

Deno.test("another writer's end row can stand in for the end but is never retired here", () => {
  const theirs = { ...row("theirs", "auction_ended", "2026-10-14", "2026-10-07T09:00:00Z"), data_source: "score-live-auctions" };
  const mine = { ...row("mine", "auction_ended", "2026-10-15", "2026-10-07T09:00:00Z"), data_source: "extract-bat-core" };
  assertEquals(planEndRows([theirs, mine], { eventType: "auction_sold", eventDate: "2026-10-15" }).retire.map((r) => r.id), ["mine"]);
  const theirsSold = { ...row("sold", "auction_sold", "2026-10-15", after(60_000)), data_source: "score-live-auctions" };
  assertEquals(planEndRows([theirsSold], { eventType: "auction_sold", eventDate: "2026-10-15" }).keepId, "sold");
});
