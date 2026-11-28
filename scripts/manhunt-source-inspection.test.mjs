import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { inspectPdfBuffer, resolveReferenceSource } from "./manhunt-source-inspection.mjs";

const project = "https://example.supabase.co";

test("resolves real storage-key shapes without assuming another host is our bucket", () => {
  const key = "manhunt/k5-blazer/gm_wiring_manual_87_complete.pdf";
  assert.deepEqual(resolveReferenceSource(key, project), { kind: "storage", path: key });
  assert.deepEqual(resolveReferenceSource(`${project}/storage/v1/object/public/reference-docs/manhunt/k5-blazer/parts%20guide.pdf`, project),
    { kind: "storage", path: "manhunt/k5-blazer/parts guide.pdf" });
  const other = "https://other.example/storage/v1/object/public/reference-docs/manual.pdf";
  assert.deepEqual(resolveReferenceSource(other, project), { kind: "external", url: other });
});

test("refuses ambiguous keys, traversal, credentials, and non-HTTP external paths", () => {
  for (const source of ["", "../manual.pdf", "/manual.pdf", "manhunt//manual.pdf", "manhunt/%2e%2e/manual.pdf",
    "manhunt/a%2fb.pdf", "manhunt/a\\b.pdf", "manhunt/a.pdf?x=1", "file:///tmp/manual.pdf",
    "https://user:secret@example.com/a.pdf", `${project}/storage/v1/object/public/reference-docs/a/%2e%2e/b.pdf`,
    `${project}/storage/v1/object/public/reference-docs/a%2Fb.pdf`,
    `${project}/storage/v1/object/public/reference-docs/a/%252e%252e/b.pdf`,
    `${project}/storage/v1/object/public/reference-docs/a.pdf?token=example`]) {
    assert.throws(() => resolveReferenceSource(source, project), undefined, source);
  }
});

test("inventory preserves page boundaries and does not call low-text image pages blank", async () => {
  const cleaned = [];
  let destroyed = false;
  const definitions = [
    { text: ["Wiring"], ops: [OPS.paintImageXObject, OPS.constructPath] },
    { text: ["A page with enough extractable words"], ops: [] },
  ];
  const open = ({ data }) => {
    assert.deepEqual(Buffer.from(data), Buffer.from("source bytes"));
    return { promise: Promise.resolve({
      numPages: definitions.length,
      async getPage(number) {
        const d = definitions[number - 1];
        return {
          async getTextContent() { return { items: d.text.map((str) => ({ str })) }; },
          async getOperatorList() { return { fnArray: d.ops }; },
          cleanup() { cleaned.push(number); },
        };
      },
      async destroy() { destroyed = true; },
    }) };
  };
  const inventory = await inspectPdfBuffer(Buffer.from("source bytes"), open);
  assert.equal(inventory.source_sha256, createHash("sha256").update("source bytes").digest("hex"));
  assert.equal(inventory.page_count, 2);
  assert.equal(inventory.pages_below_text_chunk_threshold, 1);
  assert.equal(inventory.pages_with_image_paint_operators, 1);
  assert.equal(inventory.pages_with_path_construction_operators, 1);
  assert.deepEqual(inventory.pages.map((p) => p.page_number), [1, 2]);
  assert.equal(inventory.pages[0].below_text_chunk_threshold, true);
  assert.equal(inventory.pages[0].image_paint_operators, 1);
  assert.deepEqual(cleaned, [1, 2]);
  assert.equal(destroyed, true);
});

test("closes the PDF and page if extraction fails instead of reporting partial success", async () => {
  let cleaned = false;
  let destroyed = false;
  const open = () => ({ promise: Promise.resolve({
    numPages: 1,
    async getPage() { return {
      async getTextContent() { throw new Error("bad page"); },
      cleanup() { cleaned = true; },
    }; },
    async destroy() { destroyed = true; },
  }) });
  await assert.rejects(inspectPdfBuffer(Buffer.from("source"), open), /bad page/);
  assert.equal(cleaned, true);
  assert.equal(destroyed, true);
});

function fixturePdf() {
  const stream = "BT /F1 12 Tf 40 100 Td (Source page with some sample text.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function runCliAgainstMockSource(bytes) {
  const requests = [];
  const documentId = "11111111-1111-4111-8111-111111111111";
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (request.url.startsWith("/rest/v1/library_documents?")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([{ id: documentId, title: "Test manual", file_url: "manhunt/k5-blazer/manual.pdf", file_size_bytes: bytes.length, document_type: "service_manual" }]));
    } else if (request.url.includes("/reference-docs/manhunt/k5-blazer/manual.pdf")) {
      response.writeHead(200, { "content-type": "application/pdf" }).end(bytes);
    } else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const script = fileURLToPath(new URL("./parse-manhunt-pdfs.mjs", import.meta.url));
    const child = spawn(process.execPath, [script, "--inspect-source", "--doc-id", documentId], {
      env: { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_PUBLISHABLE_KEY: "test-publishable-key" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (part) => { stdout += part; });
    child.stderr.setEncoding("utf8").on("data", (part) => { stderr += part; });
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    return { code, stderr, receipt: JSON.parse(stdout), requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("CLI follows a relative storage key and makes only read requests", async () => {
  const result = await runCliAgainstMockSource(fixturePdf());
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.receipt.status, "pdf_inspected");
  assert.equal(result.receipt.source_key, "manhunt/k5-blazer/manual.pdf");
  assert.equal(result.receipt.page_count, 1);
  assert.equal(result.receipt.recorded_size_matches, true);
  assert.equal(result.requests.length, 2);
  assert.ok(result.requests.every((r) => r.method === "GET"));
});

test("CLI records actual HTML bytes as a failure even when named and served as PDF", async () => {
  const bytes = Buffer.from("<!doctype html><html><body>Not a PDF</body></html>");
  const result = await runCliAgainstMockSource(bytes);
  assert.equal(result.code, 1);
  assert.equal(result.receipt.status, "pdf_inspection_failed");
  assert.equal(result.receipt.signature, "html");
  assert.equal(result.receipt.source_sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.ok(result.requests.every((r) => r.method === "GET"));
});
