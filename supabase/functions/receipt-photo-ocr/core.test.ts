// receipt-photo-ocr: the document route lands a page and, with a vehicle, a receipt through the existing writers.
// Every dependency is a mock; nothing touches prod.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { brandOnly, type Deps, type Extraction, type FrameRow, handle, landType, parseIsoDate, sanitizeExtraction, toLandingDocument } from "./core.ts";

const IMG = "11111111-2222-4333-8444-555555555555";
const USER = "aaaaaaaa-0000-4000-8000-00000000000a";
const VEH = "bbbbbbbb-0000-4000-8000-00000000000b";
const URL = "https://proj.supabase.co/storage/v1/object/public/vehicle-photos/users/x/capture-relay/abc/IMG_5260.HEIC";

const frame = (over: Partial<FrameRow> = {}): FrameRow => ({ id: IMG, user_id: USER, vehicle_id: null, image_url: URL, file_name: "IMG_5260.HEIC", taken_at: "2026-10-31T17:02:00Z", ...over });

const receiptData: Extraction = {
  vendor_name: "Example Fuel Co", vendor_address: "1 Example Rd, Exampleville, NV", date: "2026-10-31", receipt_number: "778812",
  line_items: [{ description: "Unleaded 12.896 gal", quantity: 12.896, unit_price: 5.299, amount: 68.34 }, { description: "Car wash", amount: 9.0 }],
  subtotal: 77.34, tax: 0, total: 77.34, payment_method: "Visa Debit ending 4421", customer_name: "A Customer",
  _provider: "anthropic", _model: "claude-sonnet", _cost_usd: 0.004, _needs_review: false, _review_reasons: [],
};

function deps(over: Partial<Deps> = {}, calls: Array<[string, unknown]> = []): Deps {
  return {
    frame: () => Promise.resolve(frame()),
    existingPage: () => Promise.resolve(null),
    classify: (url) => { calls.push(["classify", url]); return Promise.resolve({ document_type: "receipt", confidence: 92 }); },
    extract: (url, t) => { calls.push(["extract", { url, t }]); return Promise.resolve({ ...receiptData }); },
    fetchBytes: () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/heic" }),
    upload: (path, bytes, ct) => { calls.push(["upload", { path, n: bytes.byteLength, ct }]); return Promise.resolve({ error: null }); },
    upsertPage: (row) => { calls.push(["page", row]); return Promise.resolve({ error: null }); },
    land: (owner, vehicle, run, docs) => { calls.push(["land", { owner, vehicle, run, docs }]); return Promise.resolve({ landed: 1, duplicates: 0, errors: 0, documents: [{ source_key: `capture:${IMG}`, receipt_id: "r-1", document_id: "d-1", duplicate: false, lines: 2 }] }); },
    bridge: (id) => { calls.push(["bridge", id]); return Promise.resolve(); },
    env: (n) => (n === "SUPABASE_URL" ? "https://proj.supabase.co" : undefined),
    now: () => new Date("2026-11-08T18:00:00Z"),
    runId: () => "run-1",
    sha256: () => Promise.resolve("a".repeat(64)),
    ...over,
  };
}

Deno.test("a receipt on a frame with a vehicle: page recorded, landed through land_document_pages, bridged", async () => {
  const calls: Array<[string, unknown]> = [];
  const r = await handle({ image_id: IMG }, deps({ frame: () => Promise.resolve(frame({ vehicle_id: VEH })) }, calls));
  assertEquals(r.status, 200);
  assertEquals(r.page, true);
  assertEquals(r.landed, true);
  assertEquals(r.receipt_id, "r-1");
  assertEquals(r.line_items_count, 2);
  assertEquals(r.document_type, "receipt");
  assertEquals(r.confidence, 0.92);
  const up = calls.find((c) => c[0] === "upload")![1] as { path: string; ct: string };
  assertEquals(up.path, `${USER}/capture/${IMG}.heic`);
  assertEquals(up.ct, "image/heic");
  const page = calls.find((c) => c[0] === "page")![1] as Record<string, unknown>;
  assertEquals(page.doc_type, "receipt");
  assertEquals(page.doc_date, "2026-10-31");
  assertEquals(page.date_source, "ocr");
  assertEquals(page.class_conf, 0.92);
  const ex = page.extraction as Record<string, unknown>;
  assertEquals(ex._provider, undefined, "the worker's bookkeeping keys stay out of the record");
  assertEquals(ex.storage_path, `${USER}/capture/${IMG}.heic`);
  const land = calls.find((c) => c[0] === "land")![1] as { owner: string; vehicle: string; run: string; docs: { storage_base: string; method: string; documents: Array<Record<string, unknown>> } };
  assertEquals(land.owner, USER);
  assertEquals(land.vehicle, VEH);
  assertEquals(land.run, "capture-document-route");
  assertEquals(land.docs.storage_base, "https://proj.supabase.co");
  const d = land.docs.documents[0];
  assertEquals(d.source_key, `capture:${IMG}`);
  assertEquals(d.doc_type, "receipt");
  assertEquals((d.vendor as { name: string }).name, "Example Fuel Co");
  assertEquals(d.doc_number, "778812");
  assertEquals(d.doc_date, "2026-10-31");
  assertEquals(d.total, 77.34);
  assertEquals((d.payment as { method: string }).method, "Visa", "card brand only, never digits");
  assertEquals((d.lines as unknown[]).length, 2);
  assertEquals((d.lines as Array<Record<string, unknown>>)[0].amount, 68.34);
  const pg = (d.pages as Array<Record<string, string>>)[0];
  assertEquals(pg.byte_size, "3");
  assertEquals(pg.page_no, "1");
  assertEquals(pg.role, "page");
  assertEquals(calls.find((c) => c[0] === "bridge")![1], "r-1");
});

Deno.test("no vehicle on the frame: the page is recorded and nothing lands", async () => {
  const calls: Array<[string, unknown]> = [];
  const r = await handle({ image_id: IMG }, deps({}, calls));
  assertEquals(r.status, 200);
  assertEquals(r.page, true);
  assertEquals(r.landed, false);
  assertStringIncludes(r.reason ?? "", "no vehicle");
  assert(calls.some((c) => c[0] === "page"));
  assert(!calls.some((c) => c[0] === "land"));
  assert(!calls.some((c) => c[0] === "bridge"));
  assertEquals(r.extracted_fields?.vendor_name, "Example Fuel Co");
});

Deno.test("a title or registration is a vehicle document, not a receipt: page only, even with a vehicle", async () => {
  const calls: Array<[string, unknown]> = [];
  const r = await handle({ image_id: IMG }, deps({
    frame: () => Promise.resolve(frame({ vehicle_id: VEH })),
    classify: () => Promise.resolve({ document_type: "registration", confidence: 0.88 }),
    extract: () => Promise.resolve({ vin: "1G1AA0000A0000000", year: 1973, make: "Example", model: "Coupe", registered_owner: "A Owner", owner_address: "1 Example St" }),
  }, calls));
  assertEquals(r.landed, false);
  assertStringIncludes(r.reason ?? "", "vehicle document");
  assert(!calls.some((c) => c[0] === "land"));
  const page = calls.find((c) => c[0] === "page")![1] as Record<string, unknown>;
  assertEquals(page.doc_type, "registration");
  assertEquals(page.date_source, "none");
  assertEquals(page.doc_date, null);
});

Deno.test("sanitizeExtraction removes e-mail addresses, card-length numbers and raw OCR text", () => {
  const out = sanitizeExtraction({
    vendor_name: "Shop", ocr_text: "the whole page", raw_text: "x", _provider: "p",
    notes: "call bob@example.com re card 4111 1111 1111 1111 or 4111111111111111; order 12345",
    line_items: [{ description: "a".repeat(600), amount: 1 }],
  }) as Record<string, unknown>;
  assertEquals(out.ocr_text, undefined);
  assertEquals(out.raw_text, undefined);
  assertEquals(out._provider, undefined);
  assertStringIncludes(String(out.notes), "[e-mail removed]");
  assertStringIncludes(String(out.notes), "[number removed]");
  assertStringIncludes(String(out.notes), "order 12345");
  assert(!/4111/.test(String(out.notes)));
  assertEquals(((out.line_items as Array<Record<string, string>>)[0].description).length, 500);
});

Deno.test("a provided extraction lands without any provider call; the pipeline hint types it", async () => {
  const calls: Array<[string, unknown]> = [];
  const r = await handle({ image_id: IMG, extraction: { ...receiptData, ocr_text: "dump" }, reader: "claude-cli subscription" },
    deps({ frame: () => Promise.resolve(frame({ vehicle_id: VEH, doc_type_hint: "receipt" })) }, calls));
  assertEquals(r.status, 200);
  assertEquals(r.landed, true);
  assertEquals(r.document_type, "receipt");
  assert(!calls.some((c) => c[0] === "classify"));
  assert(!calls.some((c) => c[0] === "extract"));
  const page = calls.find((c) => c[0] === "page")![1] as Record<string, unknown>;
  const ex = page.extraction as Record<string, unknown>;
  assertEquals(ex.ocr_text, undefined);
  assertEquals(ex.reader, "claude-cli subscription");
  assertEquals(ex._provider, undefined);
  assertEquals(page.cost_usd, 0, "the page row's cost is a number even when the reader charged nothing");
});

Deno.test("a provided extraction updates a page that was recorded before, even with no vehicle", async () => {
  const calls: Array<[string, unknown]> = [];
  const r = await handle({ image_id: IMG, extraction: { ...receiptData }, document_type: "receipt" }, deps({
    existingPage: () => Promise.resolve({ doc_type: "other", extraction: {}, class_conf: 0, doc_date: null, run_id: "run-0" }),
  }, calls));
  assertEquals(r.page, true);
  assertEquals(r.landed, false);
  const page = calls.find((c) => c[0] === "page")![1] as Record<string, unknown>;
  assertEquals(page.doc_type, "receipt");
  assertEquals(page.run_id, "run-0");
});

Deno.test("a page already recorded with no vehicle is not read again", async () => {
  const calls: Array<[string, unknown]> = [];
  const r = await handle({ image_id: IMG }, deps({
    existingPage: () => Promise.resolve({ doc_type: "receipt", extraction: { line_items: [{}, {}, {}] }, class_conf: 0.9, doc_date: null, run_id: "run-0" }),
  }, calls));
  assertEquals(r.status, 200);
  assertEquals(r.page, true);
  assertEquals(r.landed, false);
  assertEquals(r.line_items_count, 3);
  assertEquals(r.run_id, "run-0");
  assertEquals(calls.length, 0);
});

Deno.test("a page already recorded, now with a vehicle, lands from the stored extraction without a second read", async () => {
  const calls: Array<[string, unknown]> = [];
  const r = await handle({ image_id: IMG }, deps({
    frame: () => Promise.resolve(frame({ vehicle_id: VEH })),
    existingPage: () => Promise.resolve({ doc_type: "receipt", extraction: { ...receiptData }, class_conf: 0.9, doc_date: "2026-10-31", run_id: "run-0" }),
  }, calls));
  assertEquals(r.landed, true);
  assert(!calls.some((c) => c[0] === "classify"));
  assert(!calls.some((c) => c[0] === "extract"));
  assert(calls.some((c) => c[0] === "land"));
  const page = calls.find((c) => c[0] === "page")![1] as Record<string, unknown>;
  assertEquals(page.run_id, "run-0");
});

Deno.test("unknown frame, bad id and a refused landing are reported, never thrown", async () => {
  assertEquals((await handle({ image_id: "nope" }, deps())).status, 400);
  assertEquals((await handle({ image_id: IMG }, deps({ frame: () => Promise.resolve(null) }))).status, 404);
  const r = await handle({ image_id: IMG }, deps({
    frame: () => Promise.resolve(frame({ vehicle_id: VEH })),
    land: () => Promise.resolve({ landed: 0, duplicates: 0, errors: 1, documents: [{ source_key: "x", error: "custodian is not tied to vehicle" }] }),
  }));
  assertEquals(r.status, 200);
  assertEquals(r.page, true);
  assertEquals(r.landed, false);
  assertStringIncludes(r.reason ?? "", "not tied");
});

Deno.test("words: land types, brands, dates", () => {
  assertEquals(landType("receipt", { receipt_number: "1" }), "receipt");
  assertEquals(landType("receipt", { invoice_number: "15676063" }), "invoice");
  assertEquals(landType("shipping_bill", {}), "packing_slip");
  assertEquals(landType("registration", {}), "other");
  assertEquals(brandOnly("MASTER CARD ****1234"), "Mastercard");
  assertEquals(brandOnly("apple cash"), "Apple Cash");
  assertEquals(brandOnly("4111111111111111"), undefined);
  assertEquals(parseIsoDate("2026-10-31"), "2026-10-31");
  assertEquals(parseIsoDate("2026-13-01"), undefined);
  assertEquals(parseIsoDate("10/31/2026"), undefined);
  const d = toLandingDocument(frame(), "receipt", { vendor_name: "X", line_items: "not an array" }, 0.5, { sha256: "b".repeat(64), storage_path: `${USER}/capture/${IMG}.jpg`, byte_size: 10 });
  assertEquals(d.lines.length, 0);
  assertEquals(d.vendor.name, "X");
  assertEquals(d.payment, undefined);
});
