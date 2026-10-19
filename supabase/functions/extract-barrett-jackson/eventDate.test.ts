import { assertEquals } from "jsr:@std/assert@1";
import { docketEventYear, lotEventDate } from "./eventDate.ts";

const LOT = "https://barrett-jackson.com/scottsdale-2004/docket/vehicle/1956-chevrolet-corvette-convertible-20203";

Deno.test("an upcoming event advertised first on the page is not the lot's date", () => {
  const html = String.raw`{\"start_date\":\"2026-04-16T00:00:00\"},{\"event_slug\":\"scottsdale-2004\",\"start_date\":\"2004-01-17\"}`;
  assertEquals(lotEventDate(html, LOT), "2004-01-17");
});

Deno.test("a page whose only start_date is another year's event has no lot date", () => {
  assertEquals(lotEventDate(String.raw`{\"start_date\":\"2026-04-16\"}`, LOT), null);
});

Deno.test("plain and escaped RSC quoting both read", () => {
  assertEquals(lotEventDate(`{"start_date": "2004-01-20"}`, LOT), "2004-01-20");
});

Deno.test("no event year in the URL is an unknown date", () => {
  assertEquals(lotEventDate(`{"start_date":"2004-01-20"}`, "https://barrett-jackson.com/Events/Event/Details/x"), null);
});

Deno.test("the docket year reads from multi-word event slugs", () => {
  assertEquals(docketEventYear("https://www.barrett-jackson.com/scottsdale-fall-2025/docket/vehicle/x-1"), "2025");
  assertEquals(docketEventYear("https://barrett-jackson.com/las-vegas-2017/docket/vehicle/2009-bmw-z4-211077"), "2017");
  assertEquals(docketEventYear("https://barrett-jackson.com/scottsdale-march-2021/docket/vehicle/x"), "2021");
});
