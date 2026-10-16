import { summarizePage } from "./catalogSummary.ts";

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

Deno.test("a docket page: title, vehicle links, totals and paging are read", () => {
  const html = `<title> 2026 Scottsdale | Docket </title><a href="/2026-scottsdale/docket/vehicle/1957-chevrolet-bel-air-1">x</a>
    <a href="/2026-scottsdale/docket/vehicle/1957-chevrolet-bel-air-1">dup</a><a href="/2026-scottsdale/docket/vehicle/1960-ford-2">y</a>
    <a href="/2025-scottsdale/docket">past</a><span>1,914 Vehicles</span><a href="?page=2">2</a><a href="?page=3">3</a>`;
  const s = summarizePage(html);
  eq([s.title, s.vehicleLinks, s.docketLinks, s.pageParams, s.totals[0]], ["2026 Scottsdale | Docket", 2, ["/2025-scottsdale/docket"], [2, 3], { text: "1,914 Vehicles", n: 1914 }]);
});

Deno.test("a Strapi-style JSON page states its total", () => {
  eq(summarizePage('{"data":[],"meta":{"pagination":{"page":1,"pageSize":1,"pageCount":39750,"total":39750}}}').jsonTotal, 39750);
});

Deno.test("a challenge page is flagged", () => {
  eq(summarizePage("<html><title>Just a moment...</title><body>Checking your browser</body></html>").challenge, true);
  eq(summarizePage("<html><title>2026 Scottsdale</title>" + "x".repeat(90000) + "</html>").challenge, false);
});
