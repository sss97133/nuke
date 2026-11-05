import { assertEquals } from "jsr:@std/assert@1";
import { classifyKind } from "./classify.ts";

Deno.test("a parts invoice with 'vintage' in a line is a work record, not a specification", () => {
  assertEquals(classifyKind({ vendor_name: "Classic Industries",
    raw_json: { data_v2: { document_type: "invoice", line_items: [{ description: "70-81 VINTAGE DASH GRAB HANDLE" }] } } }), "work_record");
});
Deno.test("JSON keys never classify: a receipt whose only 'title' is a key stays a work record", () => {
  assertEquals(classifyKind({ vendor_name: "Some Shop", raw_json: { title: "x", data_v2: { document_type: "work_order", line_items: [{ description: "Bore cylinders .060" }] } } }), "work_record");
});
Deno.test("an insurance paper is a specification even from a parts seller's name", () => {
  assertEquals(classifyKind({ vendor_name: "Geico", raw_extraction: { data: { notes: "policy renewal" } } }), "specification");
});
Deno.test("registration words at word boundaries still classify a document", () => {
  assertEquals(classifyKind({ vendor_name: "County Clerk", raw_extraction: { data: { line_items: [{ description: "Vehicle registration renewal" }] } } }), "specification");
});
Deno.test("a receipt with no recognisable words is a comment", () => {
  assertEquals(classifyKind({ vendor_name: "Corner Deli", raw_json: { data_v2: { line_items: [{ description: "Sandwich" }] } } }), "comment");
});
