import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchMecumFeedUrls, mecumSearch } from "./mecumSearch.ts";

Deno.test("Mecum discovery reads current sales and canonical vehicle lots without HTML or inference", async () => {
  const calls: URLSearchParams[] = [];
  const now = Date.UTC(2026, 9, 30);
  const epoch = now / 1000;
  const result = await fetchMecumFeedUrls(async params => {
    const query = new URLSearchParams(params); calls.push(query);
    if (calls.length === 1) return { facets: { "taxonomies.auction_tax.name": {
      [`Past|1|2`]: 20, [`Current|${epoch - 100}|${epoch + 100}`]: 4,
      [`Upcoming|${epoch + 200}|${epoch + 300}`]: 10,
    } } };
    return { hits: [
      { permalink: "/lots/123/1980-ford-f100/" },
      { permalink: "https://www.mecum.com/lots/123/1980-ford-f100" },
      { permalink: "/lots/456/sign/", taxonomies: { division_tax: [{ name: "Road Art" }] } },
      { permalink: "https://outside.invalid/lots/7/wrong" },
      { permalink: "/auctions/upcoming" },
      { permalink: "/lots/999/car?redirect=outside" },
      { permalink: "http://[" },
      null,
      { permalink: "/lots/1000/unknown", taxonomies: { division_tax: {} } },
    ] };
  }, now);
  assertEquals(result, { urls: ["https://www.mecum.com/lots/123/1980-ford-f100"], confirmedEmpty: false });
  assertEquals(calls.length, 2);
  assertEquals(calls[1].get("hitsPerPage"), "300");
  assertEquals(calls[1].get("filters"), `taxonomies.auction_tax.name:"Current|${epoch - 100}|${epoch + 100}" OR taxonomies.auction_tax.name:"Upcoming|${epoch + 200}|${epoch + 300}"`);
});

Deno.test("only an explicit roster without current sales is a confirmed empty search", async () => {
  assertEquals(await fetchMecumFeedUrls(async () => ({ facets: { "taxonomies.auction_tax.name": { "Past|1|2": 1 } } })), { urls: [], confirmedEmpty: true });
  await assertRejects(() => fetchMecumFeedUrls(async () => ({})), Error, "missing sale facets");
  for (const [hits, message] of [[[], "missing listed lots"], [[null, { permalink: "http://[" }], "no vehicle lot URLs"]] as const) {
    let calls = 0;
    await assertRejects(() => fetchMecumFeedUrls(async () => ++calls === 1
      ? { facets: { "taxonomies.auction_tax.name": { "Future|1|9999999999": 1 } } }
      : { hits }), Error, message);
  }
});

Deno.test("Mecum public API refuses HTTP errors and malformed results", async () => {
  for (const [reply, error] of [[new Response("", { status: 403 }), "HTTP 403"],
    [Response.json({ results: [{ message: "denied" }] }), "invalid result"],
    [Response.json({ results: [] }), "invalid result"]] as const) {
    await assertRejects(() => mecumSearch("hitsPerPage=0", (() => Promise.resolve(reply)) as typeof fetch), Error, error);
  }
});
