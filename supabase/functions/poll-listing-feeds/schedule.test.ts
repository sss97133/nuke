// Run: deno test supabase/functions/poll-listing-feeds/schedule.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { nextYield, tierOf } from "./schedule.ts";

Deno.test("a busy metro is read on every run, a quiet one backs off to hours", () => {
  // 6 new posts in 1 hour: rate 6/h, wants a poll every 20 minutes
  assertEquals(nextYield(null, 6, 1).interval_minutes, 20);
  // 30 new in 1 hour: capped at the floor
  assertEquals(nextYield(null, 30, 1).interval_minutes, 10);
  // nothing new: the ceiling
  assertEquals(nextYield(null, 0, 1).interval_minutes, 360);
});

Deno.test("the rate is smoothed, so one empty poll does not erase a busy history", () => {
  const busy = nextYield(null, 6, 1); // 6/h
  const after = nextYield(busy.rate, 0, 0.5);
  assertEquals(after.rate, 3.6);
  assertEquals(after.interval_minutes, 33);
});

Deno.test("a poll right after the last one is read as at least ten minutes; a first poll as a day of posts", () => {
  assertEquals(nextYield(null, 1, 0).rate, 6);
  // a never-polled feed shows its whole backlog: 48 posts is 2 an hour, not 288
  assertEquals(nextYield(null, 48, null).rate, 2);
  assertEquals(nextYield(null, 48, null).interval_minutes, 60);
});

Deno.test("tier orders feeds, and a feed with no tier comes last", () => {
  assertEquals(tierOf({ search_criteria: { tier: 1 } }), 1);
  assertEquals(tierOf({ search_criteria: { tier: "2" } }), 2);
  assertEquals(tierOf({ search_criteria: {} }), 9);
  assertEquals(tierOf({ search_criteria: { tier: 12 } }), 9);
  assertEquals(tierOf({}), 9);
});
