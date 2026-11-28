/** Service-only source-page admission for a public PDF already in storage. */
import { ReferenceError } from './suppliedReference.ts';

type Obj = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const allowed = ['title', 'source_url', 'object_id', 'object_version', 'object_name', 'pdf_sha256',
  'pdf_size', 'text_sha256', 'page_count', 'reader_actor', 'reader_method', 'reader_run_id', 'reader_verified_at'];
function fail(code: string, status = 400): never { throw new ReferenceError(code, status); }
function object(value: unknown): value is Obj { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export interface AttestedPdfTextDeps {
  authorize(): Promise<boolean>;
  record(source: Obj, pages: string[]): Promise<unknown>;
  now?: number;
}

export async function recordAttestedPdfText(input: unknown, deps: AttestedPdfTextDeps) {
  if (!(await deps.authorize())) fail('attested_pdf_service_required', 403);
  if (!object(input) || input.mode !== 'attested_pdf_text' ||
    Object.keys(input).some(key => !['mode', 'source', 'pages'].includes(key)) || !object(input.source) ||
    Object.keys(input.source).some(key => !allowed.includes(key))) fail('attested_pdf_contract_invalid');
  const s = input.source;
  if (!text(s.title, 500) || !text(s.source_url, 2048) || !text(s.object_id, 36) || !uuid.test(s.object_id) ||
    !text(s.object_version, 200) || !text(s.pdf_sha256, 64) || !hash.test(s.pdf_sha256) ||
    s.object_name !== `catalog-public/${s.pdf_sha256}.pdf` ||
    !Number.isSafeInteger(s.pdf_size) || (s.pdf_size as number) < 8 || (s.pdf_size as number) > 314572800 ||
    !text(s.text_sha256, 64) || !hash.test(s.text_sha256) ||
    !Number.isInteger(s.page_count) || (s.page_count as number) < 1 || (s.page_count as number) > 5000 ||
    !text(s.reader_actor, 100) || s.reader_method !== 'client_sha256_pdftotext_v1' || !text(s.reader_run_id, 150) ||
    !text(s.reader_verified_at, 100) || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s.reader_verified_at) ||
    !Number.isFinite(Date.parse(s.reader_verified_at)) || Date.parse(s.reader_verified_at) > (deps.now ?? Date.now()) + 300_000 ||
    !Array.isArray(input.pages) || input.pages.length !== s.page_count ||
    input.pages.some(p => typeof p !== 'string' || p.length > 100000 || /[\u0000\f]/.test(p)) ||
    input.pages.reduce((sum, page) => sum + page.length, 0) > 10000000) fail('attested_pdf_contract_invalid');
  try {
    const url = new URL(s.source_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith('/') || url.pathname === '/' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('attested_pdf_source_invalid');
  } catch { return fail('attested_pdf_source_invalid'); }
  const result = await deps.record(s, input.pages);
  if (!object(result) || result.success !== true || !text(result.document_id, 36) || !uuid.test(result.document_id) ||
    !text(result.revision, 64) || !hash.test(result.revision) || result.page_count !== s.page_count ||
    result.pdf_hash_status !== 'client_attested_not_server_rehashed' ||
    result.text_provenance_status !== 'client_attested_extraction_not_server_verified' || typeof result.duplicate !== 'boolean') {
    fail('attested_pdf_receipt_invalid', 502);
  }
  return { ...result, source_pages_only: true, model_calls: 0 };
}
