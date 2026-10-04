import { sourceReadClock } from "./sourceReadClock.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("direct reads use the captured response time; repeated reads advance it", () => {
  const first = sourceReadClock("direct", "2026-10-03T12:00:00Z");
  const second = sourceReadClock("direct", "2026-10-03T12:01:03Z");
  equal(first.scraped_at, "2026-10-03T12:00:00.000Z");
  equal(second.source_read, { clock_version: 1, at: "2026-10-03T12:01:03.000Z", basis: "direct_fetch" });
});

Deno.test("cached extraction preserves the original fetch clock on every replay", () => {
  const first = sourceReadClock("snapshot", "2024-01-02T15:14:13+00:00");
  const replay = sourceReadClock("snapshot", "2024-01-02T15:14:13+00:00");
  equal(first, replay);
  equal(first.source_read, { clock_version: 1, at: "2024-01-02T15:14:13.000Z", basis: "cached_snapshot" });
});

Deno.test("missing and invalid source clocks remain unknown without using current time", () => {
  for (const source of ["direct", "snapshot"] as const) {
    for (const at of [null, "not a date"]) {
      equal(sourceReadClock(source, at), {
        scraped_at: null, source_read: { clock_version: 1, at: null, basis: "unknown" },
      });
    }
  }
});
