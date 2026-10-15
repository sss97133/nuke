import { fetchCraigslistFeed, type CraigslistArchiveOptions, type CraigslistArchiveResult } from "./feedFetch.ts";
import { fetchPage } from "../_shared/hybridFetcher.ts";
import { failureCategoryFor, intakeThrottle, selectIntakeFeeds } from "./ledger.ts";
import { emptySearchHtml as emptySearch } from "./fixtures/empty-search.ts";

const url = "https://lasvegas.craigslist.org/search/cta?min_auto_year=1960";
const html = `<html><title>Cars</title>${"public listing ".repeat(100)}</html>`;
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
async function withFetch(
  mock: typeof fetch,
  test: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await test(); } finally { globalThis.fetch = original; }
}
function archived(value: Partial<CraigslistArchiveResult>): CraigslistArchiveResult {
  return { html: null, statusCode: 200, error: null, ...value };
}
Deno.test("a successful Craigslist search explicitly corroborates its empty result", async () => {
  equal(await fetchCraigslistFeed(url, async () => archived({ html: emptySearch })),
    { html: emptySearch, error: null, confirmedEmpty: true });
});

Deno.test("empty recognition rejects ambiguous, conflicting or blocked source evidence", async () => {
  const invalid = [
    emptySearch.replace('"itemListElement":[]', '"itemListElement":null'),
    emptySearch.replace('"itemListElement":[]', '"itemListElement":['),
    emptySearch.replace('"itemListElement":[]', '"itemListElement":[{"name":"unreadable item"}]'),
    emptySearch.replace('"SearchResultsPage"', '"WebPage"'),
    emptySearch.replace('id="ld_searchpage_results"', 'id="other"'),
    emptySearch.replace('type="application/ld+json"', 'type="text/plain"'),
    emptySearch + '<script type="application/ld+json" id="ld_searchpage_results">{"@type":"ItemList","itemListElement":[]}</script>',
    emptySearch + '<script type="application/ld+json" id="ld_searchpage_results">{"@type":"ItemList","itemListElement":[{}]}</script>',
    emptySearch.replace('<script', '<!-- <script').replace('</script>', '</script> -->'),
    emptySearch.replace('class="cl-static-search-results"', 'class="other"'),
    emptySearch.replace('</ol>', ''),
    emptySearch.replace('</ol>', '<li class="cl-static-search-result">unreadable item</li></ol>'),
    emptySearch.replace('</ol>', '<li class=cl-static-search-result>unreadable item</li></ol>'),
    emptySearch + '<script>window._cf_chl_opt = {};</script>',
    emptySearch + '<h1>Access Denied</h1>',
    emptySearch + '<div class="g-recaptcha">Verify you are human</div>',
  ];
  for (const html of invalid) {
    equal((await fetchCraigslistFeed(url, async () => archived({ html }))).confirmedEmpty, undefined);
  }
  for (const override of [{ statusCode: 403 }, { statusCode: null }, { error: "Blocked by site" }]) {
    equal((await fetchCraigslistFeed(url, async () => archived({ html: emptySearch, ...override }))).confirmedEmpty, undefined);
  }
  for (const wrongUrl of ["http://lasvegas.craigslist.org/search/cta", "https://notcraigslist.org/search/cta",
    "https://craigslist.org.evil.example/search/cta", "https://www.craigslist.org/view/d/car/token"]) {
    equal((await fetchCraigslistFeed(wrongUrl, async () => archived({ html: emptySearch }))).confirmedEmpty, undefined);
  }
});

Deno.test("Craigslist requests fresh archived public HTML without a renderer", async () => {
  const calls: CraigslistArchiveOptions[] = [];
  equal(await fetchCraigslistFeed(url, async (requested, options) => {
    equal(requested, url); calls.push(options);
    return archived({ html });
  }), { html, error: null });
  equal(calls, [{ platform: "craigslist", skipCache: true, useFirecrawl: false,
    includeMarkdown: false, directFetchOptions: { publicOnly: true }, callerName: "poll-listing-feeds" }]);
});

for (const status of [401, 403, 429, 451]) {
  Deno.test(`public Craigslist HTTP ${status} is one request, visible failure and existing feed backoff`, async () => {
    let calls = 0;
    await withFetch(async (_input, init) => {
      calls++;
      equal(new Headers((init as { headers?: HeadersInit } | undefined)?.headers).get("user-agent"), "NukeListingCollector/1.0 (+https://nuke.ag)");
      return new Response("denied", { status });
    }, async () => {
      const result = await fetchCraigslistFeed(url, async (requested, options) => {
        const direct = await fetchPage(requested, options.directFetchOptions);
        return archived({ html: direct.html, error: direct.error ?? null, statusCode: direct.statusCode ?? null });
      });
      equal(result, { html: null, error: `direct: HTTP ${status}` });
      equal(calls, 1);
      const message = `fetch_failed: ${result.error}`;
      equal(failureCategoryFor(message), status === 429 ? "rate_limited" : "blocked");
      const now = Date.parse("2026-10-13T01:30:00Z");
      equal(selectIntakeFeeds([{ source_slug: "craigslist", last_polled_at: new Date(now).toISOString(),
        poll_interval_minutes: 60, last_error: message, error_count: 1 }], 1, intakeThrottle(), now + 15 * 60_000), []);
    });
  });
}

Deno.test("empty archive and thrown errors never become successful zero-listing captures", async () => {
  let calls = 0;
  equal(await fetchCraigslistFeed(url, async () => { calls++; return archived({}); }),
    { html: null, error: "direct: HTTP 200, empty payload" });
  equal(calls, 1);
  equal(await fetchCraigslistFeed(url, async () => { throw new Error("timeout"); }),
    { html: null, error: "direct: timeout" });
});

Deno.test("public policy stops challenge pages and network failures without identity rotation", async () => {
  for (const response of [new Response(`<html>Access Denied ${"x".repeat(1200)}</html>`), null]) {
    let calls = 0;
    await withFetch(async () => { calls++; if (!response) throw new Error("network unavailable"); return response; }, async () => {
      const result = await fetchPage(url, { publicOnly: true, retries: 10 });
      equal(result.html, null); equal(calls, 1);
      equal(result.error, response ? "Blocked by site" : "network unavailable");
    });
  }
});

Deno.test("public redirects stop at login and outside-source destinations", async () => {
  for (const location of ["/account/login", "https://outside.example/listings", "http://lasvegas.craigslist.org/search/cta"]) {
    let calls = 0;
    await withFetch(async () => { calls++; return new Response(null, { status: 302, headers: { location } }); }, async () => {
      const result = await fetchPage(url, { publicOnly: true });
      equal(result.html, null); equal(calls, 1);
    });
  }
});

Deno.test("one public regional Craigslist redirect keeps the identified headers", async () => {
  const calls: string[] = [];
  await withFetch(async (input, init) => {
    calls.push(String(input));
    equal(new Headers((init as { headers?: HeadersInit } | undefined)?.headers).get("user-agent"), "NukeListingCollector/1.0 (+https://nuke.ag)");
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://lasvegas.craigslist.org/cto/d/car/123.html" } })
      : new Response(html);
  }, async () => {
    equal((await fetchPage("https://www.craigslist.org/view/d/car/token", { publicOnly: true })).html, html);
    equal(calls.length, 2);
  });
});

Deno.test("other callers retain their default browser headers", async () => {
  await withFetch(async (_input, init) => {
    equal(new Headers((init as { headers?: HeadersInit } | undefined)?.headers).get("user-agent")?.startsWith("Mozilla/"), true);
    return new Response(html);
  }, async () => { equal((await fetchPage("https://example.com")).html, html); });
});
