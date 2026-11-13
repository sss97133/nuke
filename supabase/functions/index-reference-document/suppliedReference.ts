/** Retain an already reviewed public reference; no model, fetcher or vehicle filing. */
export const REFERENCE_METHOD = 'supplied_reference_assembly_v1';
export const MAX_REFERENCE_BYTES = 6 * 1024 * 1024;
type Obj = Record<string, any>;
export class ReferenceError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
function check(ok: unknown, code: string, status = 400): asserts ok {
  if (!ok) throw new ReferenceError(code, status);
}
function object(value: unknown): value is Obj { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max = 500): value is string { return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max; }
function clock(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)); }
function keys(value: Obj, allowed: string[]) { check(Object.keys(value).every(key => allowed.includes(key)), 'reference_unknown_field'); }
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(x => x.toString(16).padStart(2, '0')).join('');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function validateReference(input: unknown, now = Date.now()) {
  check(object(input), 'reference_object_required');
  keys(input, ['mode', 'document', 'pages', 'assembly', 'reader', 'reviewed_at']);
  check(input.mode === 'supplied_reference', 'reference_mode_required');
  const d = input.document, a = input.assembly;
  check(object(d) && object(a) && object(input.reader), 'reference_contract_required');
  keys(d, ['title', 'category', 'source_url', 'pdf_sha256', 'pdf_base64', 'page_count', 'retrieved_day', 'retrieved_at']);
  check(text(d.title) && ['parts_catalog', 'service_manual', 'component_drawing', 'component_datasheet'].includes(d.category), 'reference_document_invalid');
  check(text(d.source_url, 2048), 'reference_source_invalid');
  let url: URL;
  try { url = new URL(d.source_url); } catch { throw new ReferenceError('reference_source_invalid'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search
    && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'reference_public_source_required');
  check(typeof d.pdf_sha256 === 'string' && /^[a-f0-9]{64}$/.test(d.pdf_sha256), 'reference_hash_invalid');
  check(Number.isInteger(d.page_count) && d.page_count >= 1 && d.page_count <= 5000, 'reference_page_count_invalid');
  check(typeof d.retrieved_day === 'string' && /^\d{4}-\d\d-\d\d$/.test(d.retrieved_day)
    && Number.isFinite(Date.parse(d.retrieved_day))
    && new Date(d.retrieved_day).toISOString().slice(0, 10) === d.retrieved_day, 'reference_capture_day_invalid');
  check(d.retrieved_at === null || clock(d.retrieved_at), 'reference_capture_clock_invalid');
  check(clock(input.reviewed_at) && Date.parse(input.reviewed_at) <= now + 300_000
    && (d.retrieved_at === null || Date.parse(input.reviewed_at) >= Date.parse(d.retrieved_at)), 'reference_review_clock_invalid');
  keys(input.reader, ['method', 'model', 'run_id']);
  check(text(input.reader.method, 100) && text(input.reader.model, 100) && text(input.reader.run_id, 150), 'reference_reader_required');
  check(Array.isArray(input.pages) && input.pages.length >= 1 && input.pages.length <= 30, 'reference_pages_invalid');
  const pages = new Map<number, Obj>();
  for (const p of input.pages) {
    check(object(p), 'reference_page_invalid');
    keys(p, ['page_number', 'printed_label', 'extracted_text', 'has_diagrams']);
    check(Number.isInteger(p.page_number) && p.page_number >= 1 && p.page_number <= d.page_count && !pages.has(p.page_number)
      && text(p.printed_label, 250) && text(p.extracted_text, 20000) && typeof p.has_diagrams === 'boolean', 'reference_page_invalid');
    pages.set(p.page_number, p);
  }
  keys(a, ['name', 'category', 'description', 'scope', 'application', 'positions', 'exclusions', 'limitations']);
  check(text(a.name, 100) && /^[a-z][a-z0-9_]*$/.test(a.name) && text(a.category, 50)
    && text(a.description, 1000) && text(a.scope, 1000), 'reference_assembly_invalid');
  check(object(a.application), 'reference_application_invalid');
  keys(a.application, ['year_start', 'year_end', 'make', 'model', 'body_style', 'series']);
  const app = a.application;
  check(Number.isInteger(app.year_start) && Number.isInteger(app.year_end) && app.year_start >= 1880
    && app.year_end >= app.year_start && app.year_end <= 2100 && text(app.make, 80) && text(app.model, 80)
    && text(app.body_style, 100) && Array.isArray(app.series) && app.series.length <= 20
    && app.series.every((x: unknown) => text(x, 50)), 'reference_application_invalid');
  for (const list of [a.exclusions, a.limitations]) check(Array.isArray(list) && list.length <= 30 && list.every((x: unknown) => text(x, 500)), 'reference_scope_invalid');
  check(a.exclusions.length > 0 && Array.isArray(a.positions) && a.positions.length >= 1 && a.positions.length <= 100, 'reference_positions_invalid');
  const seen = new Set<string>();
  for (const p of a.positions) {
    check(object(p), 'reference_position_invalid');
    keys(p, ['key', 'label', 'subject_id', 'quantity', 'part_numbers', 'part_number_binding', 'source_refs']);
    check(text(p.key, 150) && /^[a-z][a-z0-9_.]*$/.test(p.key) && !seen.has(p.key) && text(p.label, 250), 'reference_position_invalid');
    seen.add(p.key);
    // This first source-template path does not manufacture taxonomy identities.
    check(p.subject_id === null, 'reference_unresolved_subject_required');
    check(Number.isInteger(p.quantity) && p.quantity >= 1 && p.quantity <= 100, 'reference_quantity_invalid');
    check(Array.isArray(p.part_numbers) && p.part_numbers.length >= 1 && p.part_numbers.length <= 20
      && p.part_numbers.every((n: unknown) => text(n, 60)) && new Set(p.part_numbers).size === p.part_numbers.length
      && ['exact_position', 'unordered_pair'].includes(p.part_number_binding), 'reference_part_identity_invalid');
    check(p.part_number_binding !== 'exact_position' || p.part_numbers.length === 1, 'reference_part_identity_invalid');
    check(p.part_number_binding !== 'unordered_pair' || p.part_numbers.length === 2, 'reference_part_identity_invalid');
    check(Array.isArray(p.source_refs) && p.source_refs.length >= 1 && p.source_refs.length <= 20, 'reference_citation_required');
    for (const ref of p.source_refs) {
      check(object(ref), 'reference_citation_invalid');
      keys(ref, ['page_number', 'figure', 'callout', 'excerpt']);
      check(Number.isInteger(ref.page_number) && pages.has(ref.page_number) && text(ref.figure, 150)
        && text(ref.callout, 40) && text(ref.excerpt, 2000)
        && pages.get(ref.page_number)!.extracted_text.includes(ref.excerpt), 'reference_citation_invalid');
    }
  }
  check(typeof d.pdf_base64 === 'string' && d.pdf_base64.length <= Math.ceil(MAX_REFERENCE_BYTES / 3) * 4
    && /^[A-Za-z0-9+/]+={0,2}$/.test(d.pdf_base64), 'reference_pdf_size_or_encoding');
  let binary: string;
  try { binary = atob(d.pdf_base64); } catch { throw new ReferenceError('reference_pdf_encoding'); }
  check(binary.length >= 8 && binary.length <= MAX_REFERENCE_BYTES && binary.startsWith('%PDF-'), 'reference_pdf_invalid');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  check(await sha256(bytes) === d.pdf_sha256, 'reference_pdf_hash_mismatch');
  const document = { ...d }; delete document.pdf_base64;
  const assemblyHash = await sha256(new TextEncoder().encode(canonical(a)));
  return { document, pages: [...pages.values()].sort((a, b) => a.page_number - b.page_number), assembly: a,
    reader: input.reader, reviewed_at: input.reviewed_at, bytes, assemblyHash };
}
export interface ReferenceDeps {
  authorize(): Promise<boolean>;
  retain(bytes: Uint8Array, hash: string): Promise<void>;
  record(document: Obj, pages: Obj[], reader: Obj, reviewedAt: string): Promise<Obj>;
  ingest(observation: Obj): Promise<Obj>;
  project(observationId: string): Promise<Obj>;
  now?: number;
}
export async function recordSuppliedReference(input: unknown, deps: ReferenceDeps) {
  check(await deps.authorize(), 'reference_service_required', 403);
  const v = await validateReference(input, deps.now);
  await deps.retain(v.bytes, v.document.pdf_sha256);
  const doc = await deps.record(v.document, v.pages, v.reader, v.reviewed_at);
  check(doc?.success === true && /^[0-9a-f-]{36}$/.test(doc.document_id) && doc.file_hash === v.document.pdf_sha256
    && typeof doc.reference_revision === 'string', 'reference_document_not_persisted', 502);
  const first = v.assembly.positions[0].source_refs[0];
  const observation = {
    source_slug: 'component-maker-documentation', kind: 'specification', source_url: v.document.source_url,
    source_identifier: `reference-assembly:${doc.document_id}:${v.assemblyHash}`,
    observed_at: v.reviewed_at, agent_inferred: true, defer_analysis: true, agent_model: v.reader.model,
    extraction_method: REFERENCE_METHOD, raw_source_ref: `sha256:${v.document.pdf_sha256}`,
    content_text: `Manufacturer reference expectation: ${v.assembly.description}`,
    citation: { document_id: doc.document_id, page_number: first.page_number, excerpt: first.excerpt },
    observer_raw: { reader: v.reader }, extraction_metadata: { reader: v.reader, reviewed_at: v.reviewed_at },
    structured_data: { reference_assembly: v.assembly, reference_revision: doc.reference_revision,
      reference_file_hash: doc.file_hash, definition_role: 'manufacturer_expected_scope', taxonomy_binding: 'unresolved' },
  };
  const landed = await deps.ingest(observation);
  check(landed?.success === true && /^[0-9a-f-]{36}$/.test(landed.observation_id), 'reference_observation_not_persisted', 502);
  const projected = await deps.project(landed.observation_id);
  check(projected?.success === true && projected.observation_id === landed.observation_id && projected.document_id === doc.document_id,
    'reference_projection_not_persisted', 409);
  return { ...projected, model_calls: 0, observation_duplicate: landed.duplicate === true };
}
