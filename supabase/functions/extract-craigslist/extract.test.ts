// Run: deno test --allow-read=supabase/functions/extract-craigslist/fixtures supabase/functions/extract-craigslist/extract.test.ts
// What extract-craigslist returns for a page, and the import_queue row it would write.
import { buildQueueRow, extractFromHtml } from "./extract.ts";

function equal(actual: unknown, expected: unknown, note = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${note} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const page = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const URL1 = "https://www.craigslist.org/view/d/sample-vehicle/FixtureToken000001";

Deno.test("the listing: what was already read is still read, from the same page", () => {
  const x = extractFromHtml(page("classic-vin-manual-truck.html"), URL1);
  equal(
    [x.url, x.title, x.year, x.make, x.model, x.price, x.location, x.mileage],
    [URL1, "SAMPLE VEHICLE", 1975, "Chevy", "k10 4x4", 1234, "Sampletown", 96213],
  );
  equal(
    [x.exterior_color, x.transmission, x.drivetrain, x.fuel_type, x.cylinders, x.body_style, x.condition, x.title_status],
    ["silver", "manual", "4wd", "gas", "8 cylinders", "truck", "good", "clean"],
  );
  equal(x.image_urls.length, 2);
  assert((x.description ?? "").startsWith("SAMPLE POSTING TEXT."), "description");
});

Deno.test("the description is the posting text without tags or the QR block, and no tag fragment survives", () => {
  const html = page("classic-vin-manual-truck.html").replace(
    "SAMPLE POSTING TEXT.",
    "SAMPLE POSTING TEXT. <scr<script>ipt>alert(1)</scr</script>ipt> line one<br>line two",
  );
  const d = extractFromHtml(html, URL1).description ?? "";
  assert(!d.includes("<"), `no < in the description: ${d}`);
  assert(!d.includes("QR Code Link"), "the QR block is gone");
  assert(d.includes("line one") && d.includes("line two"), "the text is kept");
});

Deno.test("the listing now carries the VIN, the post id, both clocks and the whole block", () => {
  const x = extractFromHtml(page("classic-vin-manual-truck.html"), URL1);
  equal([x.vin, x.post_id, x.posted_at, x.updated_at], ["CKY145Z123456", "7000000001", "2026-01-02T11:04:05.000Z", "2026-01-03T12:05:06.000Z"]);
  equal(x.attributes.vin_raw, "CKY145Z123456");
  equal(x.attributes.raw["auto_miles"], "96,213");
});

Deno.test("a VIN the rules do not accept is not on the listing; the seller's text still is", () => {
  const bad = page("modern-vin-17-full-block.html").replace("1B7KF23D3WJ123456", "1B7KF23D4WJ123456");
  const x = extractFromHtml(bad, URL1);
  equal([x.vin, x.attributes.vin, x.attributes.vin_raw, x.attributes.vin_rejected], [null, null, "1B7KF23D4WJ123456", "check_digit_failed"]);
});

Deno.test("the 10,000,000 odometer is no longer written as mileage", () => {
  const x = extractFromHtml(page("odometer-placeholder-ten-million.html"), URL1);
  equal([x.mileage, x.attributes.odometer_raw], [null, "10,000,000"]);
});

// ---- the queue payload ---------------------------------------------------------------------------------------

Deno.test("the queue row's raw_data carries the attribute block, the post id and the clocks", () => {
  const row = buildQueueRow(extractFromHtml(page("classic-vin-manual-truck.html"), URL1)) as any;
  equal([row.listing_url, row.listing_title, row.listing_price, row.listing_year, row.listing_make, row.listing_model, row.status, row.extractor_version],
    [URL1, "SAMPLE VEHICLE", 1234, 1975, "Chevy", "k10 4x4", "pending", "extract-craigslist-v2"]);
  const raw = row.raw_data;
  equal([raw.post_id, raw.posted_at, raw.updated_at], ["7000000001", "2026-01-02T11:04:05.000Z", "2026-01-03T12:05:06.000Z"]);
  const a = raw.attributes;
  equal(
    [a.vin, a.odometer, a.title_status, a.condition, a.transmission, a.drive, a.fuel, a.cylinders, a.paint_color, a.type],
    ["CKY145Z123456", 96213, "clean", "good", "manual", "4wd", "gas", "8 cylinders", "silver", "truck"],
  );
  equal(Object.keys(a.raw).length, 12);
});

Deno.test("the queue row keeps every key it had before", () => {
  const raw = (buildQueueRow(extractFromHtml(page("classic-vin-manual-truck.html"), URL1)) as any).raw_data;
  for (const k of ["mileage", "location", "exterior_color", "transmission", "drivetrain", "fuel_type", "cylinders", "body_style", "condition", "title_status", "description", "image_urls", "posted_at"]) {
    assert(k in raw, `raw_data.${k}`);
  }
  equal([raw.mileage, raw.location, raw.exterior_color, raw.drivetrain, raw.fuel_type], [96213, "Sampletown", "silver", "4wd", "gas"]);
});

Deno.test("a post with no VIN still has the attributes object, with the VIN null", () => {
  const raw = (buildQueueRow(extractFromHtml(page("no-vin-diesel-fair.html"), URL1)) as any).raw_data;
  equal([raw.attributes.vin, raw.attributes.vin_raw, raw.attributes.vin_rejected], [null, null, null]);
  equal(raw.attributes.odometer, 219500);
});

Deno.test("a page with no attribute block still produces an attributes object, all null, so absence is recorded", () => {
  const html = page("classic-vin-manual-truck.html").replace(/<div class="attrgroup">[\s\S]*?<section id="postingbody">/, '<section id="postingbody">');
  const raw = (buildQueueRow(extractFromHtml(html, URL1)) as any).raw_data;
  equal(raw.attributes.raw, {});
  equal([raw.attributes.vin, raw.attributes.odometer, raw.attributes.title_status], [null, null, null]);
});

Deno.test("the queue row is plain JSON", () => {
  const row = buildQueueRow(extractFromHtml(page("modern-vin-17-full-block.html"), URL1));
  equal(JSON.parse(JSON.stringify(row)), row);
});

Deno.test({
  name: "the fetching extractor carries the cached snapshot's actual clock from a keyed metadata read, without another source visit",
  sanitizeOps: false, sanitizeResources: false,
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalServe = Deno.serve;
    const oldUrl = Deno.env.get("SUPABASE_URL");
    const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    Deno.env.set("SUPABASE_URL", "https://stub.supabase.test");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    const snapshot = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", fetched_at: "2026-01-04T01:02:03.456Z",
      html: page("classic-vin-manual-truck.html"), markdown: null, html_storage_path: null, markdown_storage_path: null };
    const requests: URL[] = [];
    let handler: (req: Request) => Promise<Response>;
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = (fn: typeof handler) => { handler = fn; };
    globalThis.fetch = async (input, init) => {
      const url = new URL(new Request(input, init).url);
      requests.push(url);
      equal(url.hostname, "stub.supabase.test", "only retained archive reads are permitted");
      equal(url.pathname, "/rest/v1/listing_page_snapshots");
      const keyed = url.searchParams.has("id");
      if (keyed) {
        equal([url.searchParams.get("id"), url.searchParams.get("platform"), url.searchParams.get("success")],
          [`eq.${snapshot.id}`, "eq.craigslist", "eq.true"]);
      }
      return new Response(JSON.stringify(keyed ? { id: snapshot.id, fetched_at: snapshot.fetched_at } : [snapshot]),
        { headers: { "content-type": "application/json" } });
    };
    try {
      await import("./index.ts");
      const response = await handler!(new Request("https://test.local/functions/v1/extract-craigslist", {
        method: "POST", headers: { Authorization: "Bearer test-service-role-key", "Content-Type": "application/json" },
        body: JSON.stringify({ url: URL1, save_to_db: false }),
      }));
      equal(response.status, 200);
      const result = await response.json();
      equal(result.extracted.source_capture, { snapshot_id: snapshot.id, observed_at: snapshot.fetched_at });
      equal(requests.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.serve = originalServe;
      if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", oldUrl);
      if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    }
  },
});
