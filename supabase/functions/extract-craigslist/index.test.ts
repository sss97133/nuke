// Real extractor handler, with all source/DB requests mocked before importing.
const serviceKey = "test-service-role-key";
Deno.env.set("SUPABASE_URL", "https://stub.supabase.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", serviceKey);
let sourceStatus = 403;
let sourceCalls = 0;
let archives: Record<string, unknown>[] = [];
// archiveFetch creates a supabase-js client per request; dispose its auth
// refresh interval in this network-isolated harness.
const intervals = new Set<number>();
const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const id = originalSetInterval(...args); intervals.add(id); return id;
};
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
globalThis.fetch = async (input, init) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.hostname === "lasvegas.craigslist.org") {
    sourceCalls++;
    equal(req.headers.get("user-agent"), "NukeListingCollector/1.0 (+https://nuke.ag)");
    return new Response("denied", { status: sourceStatus });
  }
  if (url.hostname === "stub.supabase.test" && url.pathname === "/rest/v1/listing_page_snapshots") {
    if (req.method === "GET") return new Response("[]", { headers: { "content-type": "application/json" } });
    if (req.method === "POST") {
      archives.push(await req.json());
      return new Response(JSON.stringify({ id: "failed-original-ack" }), { status: 201, headers: { "content-type": "application/json" } });
    }
  }
  throw new Error(`Unexpected request: ${req.method} ${url.hostname}${url.pathname}`);
};
let handler: (req: Request) => Promise<Response>;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");

for (const status of [403, 429]) {
  Deno.test({ name: `Craigslist detail HTTP ${status} archives the failure once without a renderer, queue write or capture ACK`,
    fn: async () => {
    sourceStatus = status; sourceCalls = 0; archives = [];
    const response = await handler(new Request("https://stub.supabase.test/functions/v1/extract-craigslist", {
      method: "POST", headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://lasvegas.craigslist.org/cto/d/car/1234567890.html", save_to_db: true }),
    }));
    for (const interval of intervals) clearInterval(interval);
    intervals.clear();
    equal(response.status, 500);
    const result = await response.json();
    equal(result.error, `Failed to fetch: HTTP ${status}`);
    equal(result.extracted, undefined);
    equal(sourceCalls, 1);
    equal(archives.length, 1);
    equal([archives[0].success, archives[0].http_status, archives[0].html], [false, status, null]);
  }});
}
