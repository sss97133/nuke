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
