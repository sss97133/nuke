import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { archiveFetch, isGarbageHtml, pickCachedSnapshot } from "./archiveFetch.ts";
import { extractFromHtml } from "../extract-collecting-cars/extract.ts";

Deno.test("real archive cache isolates native listing pages before limit from newer board documents", async () => {
  const originalFetch = globalThis.fetch;
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"];
  const prior = names.map(name => Deno.env.get(name));
  Deno.env.set(names[0], "https://synthetic.supabase.co");
  Deno.env.set(names[1], "synthetic-key");
  Deno.env.delete(names[2]);
  const html = await Deno.readTextFile(new URL("../extract-collecting-cars/fixtures/lot-911.html", import.meta.url));
  const page = { id: "full-page", platform: "collectingcars", html, markdown: null,
    fetched_at: new Date(Date.now() - 60_000).toISOString(), fetch_method: "direct" };
  const board = { ...page, platform: "collecting-cars", id: "native-board", html: JSON.stringify({ auctionId: "90089", currentBid: "17250" }) };
  const retained = [...Array(6).fill(board), page];
  let sourceCalls = 0;
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== "synthetic.supabase.co") { sourceCalls++; throw Error("unexpected provider request"); }
      assertEquals(init?.method ?? "GET", "GET");
      assertEquals(url.searchParams.get("platform"), "eq.collectingcars");
      assertEquals(url.searchParams.get("limit"), "5");
      return Response.json(retained.filter(row => `eq.${row.platform}` === url.searchParams.get("platform")).slice(0, 5));
    };
    const result = await archiveFetch("https://collectingcars.com/for-sale/1965-porsche", { platform: "collectingcars", useFirecrawl: false });
    assertEquals(result.cached, true);
    assertEquals(result.snapshotId, page.id);
    assertEquals(result.html, html);
    assertEquals(extractFromHtml(result.html!, result.url).listing_id, "93268");
    assertEquals(sourceCalls, 0);
    assertEquals(retained.length, 7); // Neither representation is modified or deleted.

    // With only board documents, the normal existing public-fetch path runs
    // once; JSON must never reach the HTML lot parser or become a cache hit.
    let archiveWrites = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "collectingcars.com") { sourceCalls++; return new Response(html); }
      assertEquals(url.hostname, "synthetic.supabase.co");
      if (init?.method === "POST") {
        archiveWrites++;
        const captured = JSON.parse(String(init.body));
        assertEquals(captured.platform, "collectingcars");
        assertEquals(captured.html, html);
        assertEquals(captured.success, true);
        return Response.json({ id: "fresh-full-page" });
      }
      assertEquals(url.searchParams.get("platform"), "eq.collectingcars");
      return Response.json([]);
    };
    const fresh = await archiveFetch(result.url, { platform: "collectingcars", useFirecrawl: false,
      firecrawlOnBlock: false, directFetchOptions: { publicOnly: true } });
    assertEquals([fresh.cached, fresh.snapshotId, sourceCalls, archiveWrites], [false, "fresh-full-page", 1, 1]);
    assertEquals(extractFromHtml(fresh.html!, fresh.url).listing_id, "93268");
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) => prior[i] == null ? Deno.env.delete(name) : Deno.env.set(name, prior[i]!));
  }
});

Deno.test("a firecrawl snapshot is a cache hit for a direct read, and the reverse", () => {
  const fc = { id: "a", fetch_method: "firecrawl" };
  const direct = { id: "b", fetch_method: "direct" };
  assertEquals(pickCachedSnapshot([fc], "direct")?.id, "a");
  assertEquals(pickCachedSnapshot([direct], "firecrawl")?.id, "b");
  assertEquals(pickCachedSnapshot([fc, direct], "direct")?.id, "b");
  assertEquals(pickCachedSnapshot([], "direct"), null);
  assertEquals(pickCachedSnapshot(null, "direct"), null);
});

Deno.test("a large lot page that carries a login modal is not garbage", () => {
  const page = `<html><head><title>2017 Porsche 911 for sale by auction | Collecting Cars</title></head><body>${"<p>lot content</p>".repeat(20000)}
    <div class="modal">Sign in to bid. Forgot your password? Create an account or register.</div></body></html>`;
  assert(page.length > 150_000);
  assertEquals(isGarbageHtml(page, "collectingcars"), false);
});

Deno.test("a small login wall is still garbage", () => {
  const wall = `<html><head><title>Log in</title></head><body><form id="login-form"><input type="password"></form></body></html>`;
  assertEquals(isGarbageHtml(wall, "collectingcars"), true);
  const bodyOnly = `<html><body>Sign in to continue. Forgot your password? Create an account.<input type="password"></body></html>`;
  assertEquals(isGarbageHtml(bodyOnly, "x"), true);
});

Deno.test("an AWS WAF HTTP-202 challenge is not a reusable source capture", () => {
  const wall = `<html><script src="https://example.token.awswaf.com/id/challenge.js"></script>
    <script>window.AwsWafIntegration.getToken();</script></html>`;
  assertEquals(isGarbageHtml(wall, "gateway"), true);
  assertEquals(isGarbageHtml(wall + "<p>vehicle inventory</p>".repeat(1000), "gateway"), false);
  assertEquals(isGarbageHtml(`<html><p>Documentation mentions AwsWafIntegration.</p></html>`, "gateway"), false);
});
