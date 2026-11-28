/** Service-only admission of already retained, unreviewed catalog page text. */
import { ReferenceError } from './suppliedReference.ts';

type Obj = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const allowed = ['catalog_id','object_id','object_version','object_name','pdf_sha256','text_sha256',
  'page_count','chunk_count','reader_actor','reader_method','reader_run_id','reader_verified_at'];
function fail(code: string, status = 400): never { throw new ReferenceError(code, status); }
function isObject(value: unknown): value is Obj { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

export interface CatalogTextSourceDeps {
  authorize(): Promise<boolean>;
  projectUrl: string;
  record(source: Obj): Promise<unknown>;
}

export async function recordCatalogTextSource(input: unknown, deps: CatalogTextSourceDeps) {
  if (!(await deps.authorize())) fail('catalog_text_service_required', 403);
  if (!isObject(input) || input.mode !== 'retained_catalog_text' ||
      Object.keys(input).some(key => !['mode','source'].includes(key)) || !isObject(input.source) ||
      Object.keys(input.source).some(key => !allowed.includes(key))) fail('catalog_text_contract_invalid');
  const s = input.source;
  if (!text(s.catalog_id,36) || !uuid.test(s.catalog_id) || !text(s.object_id,36) || !uuid.test(s.object_id) ||
      !text(s.object_version,200) || !text(s.object_name,1000) || s.object_name.startsWith('/') ||
      s.object_name.split('/').some(segment => !segment || segment === '.' || segment === '..') ||
      !text(s.pdf_sha256,64) || !hash.test(s.pdf_sha256) || !text(s.text_sha256,64) || !hash.test(s.text_sha256) ||
      !Number.isInteger(s.page_count) || (s.page_count as number) < 1 || (s.page_count as number) > 5000 ||
      !Number.isInteger(s.chunk_count) || (s.chunk_count as number) < 1 || (s.chunk_count as number) > 10000 ||
      !text(s.reader_actor,100) || !text(s.reader_method,100) || !text(s.reader_run_id,150) ||
      !text(s.reader_verified_at,100) || !/^\d{4}-\d\d-\d\dT/.test(s.reader_verified_at) ||
      !/(?:Z|[+-]\d\d:\d\d)$/.test(s.reader_verified_at) ||
      !Number.isFinite(Date.parse(s.reader_verified_at)) || Date.parse(s.reader_verified_at) > Date.now()+300_000) fail('catalog_text_contract_invalid');
  let origin: string;
  try {
    const url = new URL(deps.projectUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      fail('catalog_text_project_url_invalid', 500);
    }
    origin = url.origin;
  } catch { return fail('catalog_text_project_url_invalid', 500); }
  const result = await deps.record({ ...s, project_origin: origin });
  if (!isObject(result) || result.success !== true || !text(result.document_id,36) || !uuid.test(result.document_id) ||
      !text(result.revision,64) || !hash.test(result.revision) || result.page_count !== s.page_count ||
      result.pdf_hash_status !== 'client_attested_not_server_rehashed' || typeof result.duplicate !== 'boolean') {
    fail('catalog_text_receipt_invalid', 502);
  }
  return { ...result, source_pages_only: true, model_calls: 0 };
}
