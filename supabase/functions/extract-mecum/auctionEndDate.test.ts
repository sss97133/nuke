import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mecumAuctionEndDate } from "./auctionEndDate.ts";

Deno.test("day start wins when it parses", () => {
  assertEquals(mecumAuctionEndDate({ auction_date: "2024-01-10", auction_day_start: "2024-01-10 15:00:00" }), "2024-01-10T15:00:00.000Z");
});
Deno.test("run day from the page date", () => {
  assertEquals(mecumAuctionEndDate({ auction_date: "2023-05-20T00:00:00", auction_day_start: null }), "2023-05-20T00:00:00.000Z");
});
Deno.test("run day from the sale roster when the page has none", () => {
  assertEquals(mecumAuctionEndDate({ auction_date: "Kissimmee", auction_day_start: null }, { run_day: "2025-01-12" }), "2025-01-12T00:00:00.000Z");
});
Deno.test("null when nothing is known", () => {
  assertEquals(mecumAuctionEndDate({ auction_date: null, auction_day_start: "garbage" }, null), null);
});
