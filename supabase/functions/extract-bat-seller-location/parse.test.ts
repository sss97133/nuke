import { assertEquals } from "jsr:@std/assert";
import { parseBatLocation } from "./parse.ts";
Deno.test("parses US location with zip", () => {
  const r = parseBatLocation('<li>Location: <a href="https://www.google.com/maps/place/Austin">Austin, Texas 78701</a></li>');
  assertEquals(r, { location_raw: "Austin, Texas 78701", city: "Austin", region: "Texas", country: "US", zip: "78701" });
});
Deno.test("parses non-US location", () => {
  const r = parseBatLocation('Location: <a href="x">Calgary, Alberta, Canada</a>');
  assertEquals(r?.city, "Calgary"); assertEquals(r?.country, "Canada"); assertEquals(r?.zip, null);
});
Deno.test("no location line", () => { assertEquals(parseBatLocation("<html>nothing</html>"), null); });

// Real misses from the first cron batches (22 Oct 2026): 332/332 inline listing misses used this layout.
const ESSENTIALS_2026 = '<div class="essentials">\n\t<h2 class="title">BaT Essentials</h2>\n\n\t<div class="item item-seller"><strong>Seller</strong>: AnonUserwvy0N</div><strong>Location</strong>: <a href="https://www.google.com/maps/place/Murfreesboro,%20Tennessee%2037129" target="_blank">Murfreesboro, Tennessee 37129</a><div ';
Deno.test("parses 2026 essentials layout (<strong>Location</strong>:)", () => {
  assertEquals(parseBatLocation(ESSENTIALS_2026), { location_raw: "Murfreesboro, Tennessee 37129", city: "Murfreesboro", region: "Tennessee", country: "US", zip: "37129" });
});
Deno.test("ignores country-only nav block and unlinked event text", () => {
  const nav = '<button class="group-title"><strong class="group-title-label">Location</strong>Located in United States<span class="watch-bell"></span></button>';
  const ev = '"description":"&lt;p&gt;From the organizer: Location: Griot\u2019s Garage 3333 S 38th [&hellip;]&lt;/p&gt;"';
  assertEquals(parseBatLocation(nav + ev), null);
});
Deno.test("prefers essentials over nav block when both present", () => {
  const nav = '<a class="group-link" href="https://bringatrailer.com/location/united-states/"><strong class="group-title-label">Location</strong>Located in United States</a>';
  assertEquals(parseBatLocation(nav + ESSENTIALS_2026)?.city, "Murfreesboro");
});
