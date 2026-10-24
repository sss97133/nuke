// deno test --allow-read supabase/functions/mcp-connector/advisor/asset_status_test.ts
import { assetIdProblem, effectiveListingStatus } from "./asset_status.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const NOW = Date.parse("2026-10-24T00:00:00Z");

Deno.test("invalid asset_id returns a clean message, not Postgres text", () => {
  assert(assetIdProblem("") === "asset_id is required", "empty");
  const m = assetIdProblem("not-a-uuid") || "";
  assert(m.startsWith('invalid asset_id "not-a-uuid"') && !/syntax|uuid:/i.test(m.split(":")[0]), m);
  assert(assetIdProblem("3f8a2c1e-0b5d-4e7a-9c3b-1d2e3f4a5b6c") === null, "valid");
});

Deno.test("ended reserve-not-met auction is not reported active", () => {
  const s = effectiveListingStatus(
    { status: "active", auction_status: "ended", reserve_status: "reserve_not_met", auction_end_date: "2026-09-01T19:00:00Z" },
    NOW,
  );
  assert(s === "ended_reserve_not_met", String(s));
  assert(effectiveListingStatus({ status: "active", auction_end_date: "2026-09-01T19:00:00Z" }, NOW) === "ended_unsold", "past end");
  assert(effectiveListingStatus({ status: "active", auction_end_date: "2026-10-30T21:45:00Z" }, NOW) === "live_auction", "live");
  assert(effectiveListingStatus({ status: "active", sale_status: "sold", sale_date: "2026-09-01" }, NOW) === "sold", "sold");
  assert(effectiveListingStatus({ status: "active" }, NOW) === "active", "no facts keeps record status");
});
