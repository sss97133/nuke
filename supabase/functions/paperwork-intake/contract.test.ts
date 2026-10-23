import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evidenceRow, queueRow, storagePath, validate } from "./contract.ts";

const page = {
  client_page_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  page_index: 0, page_count: 2, scanned_at: "2026-10-22T18:00:00.000Z", is_document: true as const,
  is_label_card: false, ocr_text: "Invoice Date 03/14/2018", document_date_hint: "2018-03-14",
  batch: { source: "label_card" as const, strength: "soft" as const, label_page_id: "33333333-3333-4333-8333-333333333333",
    label_document_id: "44444444-4444-4444-8444-444444444444", box: "3", vehicle_hint: "R3500", year_hint: 2017,
    confidence: 0.9, label_text: "Box 3, R3500 receipts 2017" },
  content_type: "image/jpeg", image_base64: "/9j/",
};

Deno.test("valid page passes and lands on the worker's documents/ path", () => {
  const v = validate(page);
  assertEquals(v.ok, true);
  assertEquals(storagePath(page, new Date("2026-10-23T05:00:00Z")),
    "documents/2026/10/23/paperwork_22222222-2222-4222-8222-222222222222_p001_11111111-1111-4111-8111-111111111111.jpg");
  assertEquals(queueRow("documents/x.jpg"), { storage_path: "documents/x.jpg", status: "pending", priority: 0 });
});

Deno.test("refuses non-documents, hard batches and malformed dates", () => {
  assertEquals(validate({ ...page, is_document: false }).ok, false);
  assertEquals(validate({ ...page, batch: { ...page.batch, strength: "hard" } }).ok, false);
  assertEquals(validate({ ...page, document_date_hint: "3/14/18" }).ok, false);
  assertEquals(validate({ ...page, page_index: 2 }).ok, false);
});

Deno.test("evidence keeps scan time apart from the document date hint", () => {
  const row = evidenceRow(page, "p", "q", null);
  assertEquals(row.scanned_at, "2026-10-22T18:00:00.000Z");
  assertEquals(row.document_date_hint, "2018-03-14");
  assertEquals(row.batch_evidence?.strength, "soft");
});
