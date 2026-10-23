import { assertEquals } from "jsr:@std/assert@1";
import { classifyIngest, eventStamp, parseEventTime, receiptOccurredAt } from "./eventTime.ts";

const now = new Date("2026-10-22T12:00:00Z");

Deno.test("a photo taken an hour ago is live", () => {
  assertEquals(eventStamp("2026-10-22T11:00:00Z", now), { occurred_at: "2026-10-22T11:00:00.000Z", ingest_kind: "live" });
});

Deno.test("a photo taken in June and uploaded now is backfill, dated June", () => {
  assertEquals(eventStamp("2026-06-20T21:55:41Z", now), { occurred_at: "2026-06-20T21:55:41.000Z", ingest_kind: "backfill" });
});

Deno.test("no event time stays unknown, never 'now'", () => {
  assertEquals(eventStamp(undefined, now), { occurred_at: null, ingest_kind: null });
  assertEquals(eventStamp("not a date", now), { occurred_at: null, ingest_kind: null });
});

Deno.test("future clocks are dropped", () => {
  assertEquals(eventStamp("2027-01-01T00:00:00Z", now).occurred_at, null);
});

Deno.test("imports are import even when dated", () => {
  assertEquals(classifyIngest(parseEventTime("2020-01-01"), now, { imported: true }), "import");
});

Deno.test("receipt event date prefers the transaction date", () => {
  assertEquals(receiptOccurredAt({ transaction_date: "2026-05-01", receipt_date: "2026-05-03" }), "2026-05-01");
  assertEquals(receiptOccurredAt({ purchase_date: "2026-04-01" }), "2026-04-01");
  assertEquals(receiptOccurredAt({}), null);
  assertEquals(eventStamp("2026-05-01", now).ingest_kind, "backfill");
});
