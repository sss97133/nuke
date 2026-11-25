import { staleClosedSnapshot } from "./staleSnapshot.ts";

const END_S = 1764007200; // the lot's own end, seconds
const END_MS = END_S * 1000;

function page(comments: unknown[], endSeconds: number | null = END_S) {
  const countdown = endSeconds === null ? "" : `<span class="listing-available-countdown" data-ends="${endSeconds}"></span>`;
  return `<html><div class="listing-available-info">${countdown}</div>` +
    `<script>var auction = {"comments":${JSON.stringify(comments)}};</script></html>`;
}

const bid = { type: "bat-bid", content: "USD $10,000 bid placed by a", bidAmount: 10000, authorName: "a", timestamp: END_S - 60 };
const sold = { type: "bat-bid-reserve", content: "Sold on 11/24/26 for USD $10,000.00 to a", authorName: "a", timestamp: END_S + 30 };
const rnm = { type: "bat-bid-reserve", content: "Reserve not met on 11/24/26, bid to USD $10,000.00", authorName: "x", timestamp: END_S + 30 };

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

Deno.test("a running lot's snapshot is used before its end", () => {
  equal(staleClosedSnapshot(page([bid]), END_MS - 1), null);
});

Deno.test("a pre-close snapshot read after the lot's end is refused", () => {
  const reason = staleClosedSnapshot(page([bid]), END_MS + 60_000);
  if (!reason || !reason.includes("has passed")) throw new Error(`expected a refusal, received ${reason}`);
  equal(typeof staleClosedSnapshot(page([bid]), END_MS), "string"); // the end minute itself is past
});

Deno.test("a page without comments read after its end is refused", () => {
  equal(typeof staleClosedSnapshot(page([]), END_MS + 1), "string");
});

Deno.test("a closed page carrying the sale or the reserve-not-met record is used", () => {
  equal(staleClosedSnapshot(page([bid, sold]), END_MS + 3_600_000), null);
  equal(staleClosedSnapshot(page([bid, rnm]), END_MS + 3_600_000), null);
});

Deno.test("a page with no end of its own is used as before", () => {
  equal(staleClosedSnapshot(page([bid], null), END_MS + 3_600_000), null);
});

Deno.test("the reader's snapshot lookup is gated by the refusal", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const call = src.indexOf("staleClosedSnapshot(String(snap.html), Date.now())");
  const gate = src.indexOf("if (!snapErr && !staleReason && snap?.html && String(snap.html).length > 1000) {");
  const use = src.indexOf('htmlSource = "snapshot";');
  if (call < 0 || gate < 0 || use < 0 || !(call < gate && gate < use)) {
    throw new Error(`snapshot lookup no longer refuses a pre-close page (call ${call}, gate ${gate}, use ${use})`);
  }
});
