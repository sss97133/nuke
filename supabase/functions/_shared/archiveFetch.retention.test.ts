import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { retainFetchedCapture } from "./archiveFetch.ts";

const snapshotId = "00000000-0000-4000-8000-000000000002";
const input = { platform: "bat", url: "https://bringatrailer.com/listing/synthetic/", httpStatus: 200,
  html: "<html>Sold for USD $12,345 — café</html>", fetchedAt: "2026-01-02T00:00:00Z" };
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function fixture(options: Record<string, any> = {}) {
  const calls: Array<{ method: string; url: URL; body?: any }> = [];
  let payload: any;
  const supabase = createClient("https://synthetic.supabase.co", "synthetic-key", { auth: { persistSession: false }, global: {
    fetch: async (request: any, init: any) => {
      const url = new URL(String(request)), method = init?.method ?? "GET";
      calls.push({ method, url, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
      if (method === "POST") {
        payload = JSON.parse(init.body);
        if (options.insertError) return Response.json({ code: options.insertError }, { status: 409 });
        return Response.json(options.missingId ? {} : { id: snapshotId });
      }
      if (url.pathname.includes("/storage/")) {
        if (options.storageError) return Response.json({ error: "unavailable" }, { status: 404 });
        return new Response(options.storageBody ?? payload.html);
      }
      if (options.readError) return Response.json({ code: "fixture_failure" }, { status: 500 });
      return Response.json(options.missingRead ? [] : [{ ...payload, id: snapshotId,
        ...(options.duplicate ? { fetched_at: "2026-01-01T00:00:00Z" } : {}), ...(options.row ?? {}) }]);
    },
  } });
  return { calls, run: () => retainFetchedCapture(supabase, input), payload: () => payload };
}

Deno.test("acknowledge actual UTF-8 retained text after PostgREST readback, with no external source fetch", async () => {
  const f = fixture(), result = await f.run();
  equal(result.status, "retained"); equal(f.calls.map(c => c.method), ["POST", "GET"]);
  equal(f.calls.every(c => c.url.hostname === "synthetic.supabase.co"), true);
  equal(f.payload().html, input.html); equal(f.payload().fetched_at, input.fetchedAt);
  equal(f.payload().metadata.rows_only, false);
  equal(f.payload().metadata.stored_representation, "utf8_text");
  equal(f.calls[1].url.searchParams.get("id"), "eq." + snapshotId);
  equal(f.calls[1].url.searchParams.get("fetched_at"), "eq." + input.fetchedAt);
});

Deno.test("a uniqueness collision needs matching retained bytes and preserves their original clock", async () => {
  const f = fixture({ insertError: "23505", duplicate: true });
  const result = await f.run(); equal(result.status, "existing");
  if (result.status === "existing") equal(result.fetched_at, "2026-01-01T00:00:00Z");
  equal(f.calls[1].url.searchParams.get("listing_url"), "eq.https://bringatrailer.com/listing/synthetic");
  equal(f.calls[1].url.searchParams.get("html_sha256"), "eq." + f.payload().html_sha256);
  equal(f.calls[1].url.searchParams.get("fetched_at"), "lte." + input.fetchedAt);
});

Deno.test("old bodyless receipts never become acknowledged retention on duplicate", async () => {
  const f = fixture({ insertError: "23505", row: { html: null } });
  equal(await f.run(), { status: "unavailable", reason: "body_unavailable" });
  equal(f.calls.filter(c => c.method !== "GET" && c.method !== "POST").length, 0);
});

Deno.test("storage duplicates require retrievable bytes and verified hash", async () => {
  for (const [extra, reason] of [[{}, null], [{ storageError: true }, "storage_body_unavailable"],
    [{ storageBody: "a different page" }, "stored_body_hash_mismatch"]] as const) {
    const f = fixture({ insertError: "23505", row: { html: null, html_storage_path: "bat/synthetic.html" }, ...extra });
    const result = await f.run();
    equal(result.status, reason ? "unavailable" : "existing");
    if ("reason" in result) equal(result.reason, reason);
  }
});

Deno.test("failed/missing acknowledgements and changed source/body/clock remain explicit", async () => {
  const cases: Array<[Record<string, any>, string]> = [
    [{ insertError: "42501" }, "capture_insert_failed"], [{ missingId: true }, "capture_id_missing"],
    [{ readError: true }, "capture_readback_unavailable"], [{ missingRead: true }, "capture_readback_unavailable"],
    [{ row: { listing_url: "https://bringatrailer.com/listing/other" } }, "capture_attribution_mismatch"],
    [{ row: { html_sha256: "wrong" } }, "capture_attribution_mismatch"],
    [{ row: { html: "wrong body" } }, "stored_body_hash_mismatch"],
    [{ row: { fetched_at: "2026-01-01T00:00:00Z" } }, "capture_clock_mismatch"],
  ];
  for (const [options, reason] of cases) {
    const result = await fixture(options).run(); equal("reason" in result ? result.reason : result.status, reason);
  }
});

Deno.test("NUL normalization keeps separate original and stored representation hashes", async () => {
  const f = fixture();
  // Exercise the same real PostgREST client with a normalized source payload.
  const original = input.html; input.html += "\u0000";
  try {
    const result = await f.run(); equal(result.status, "retained"); equal(f.payload().html, original);
    equal(f.payload().metadata.stored_representation, "utf8_text_nul_removed");
    equal(f.payload().metadata.original_html_sha256 === f.payload().html_sha256, false);
  } finally { input.html = original; }
});
