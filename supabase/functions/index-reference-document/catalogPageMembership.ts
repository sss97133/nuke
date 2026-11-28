/** Service-only links from a catalog identity to independently retained pages. */
import { ReferenceError } from './suppliedReference.ts';

type Obj = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const catalogKeys = ['name','provider','base_url','full_pdf_sha256','expected_page_count',
  'reader_actor','reader_run_id','reader_verified_at'];
const pageKeys = ['catalog_page_number','document_id','document_page_id','pdf_sha256',
  'full_geometry_sha256','individual_geometry_sha256','full_render_sha256','individual_render_sha256'];
function fail(code: string, status = 400): never { throw new ReferenceError(code, status); }
function object(v: unknown): v is Obj { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function text(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
}
function exactKeys(v: Obj, keys: string[]): boolean {
  return Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
}
export interface CatalogPageMembershipDeps {
  authorize(): Promise<boolean>;
  record(catalog: Obj, pages: Obj[]): Promise<unknown>;
  now?: number;
}
export async function recordCatalogPageMembership(input: unknown, deps: CatalogPageMembershipDeps) {
  if (!(await deps.authorize())) fail('catalog_page_service_required', 403);
  if (!object(input) || input.mode !== 'catalog_page_membership' ||
      !exactKeys(input, ['mode','catalog','pages']) || !object(input.catalog) ||
      !exactKeys(input.catalog,catalogKeys) || !Array.isArray(input.pages)) fail('catalog_page_contract_invalid');
  const c = input.catalog;
  if (!text(c.name,500) || !text(c.provider,100) || !text(c.base_url,2048) ||
      !text(c.full_pdf_sha256,64) || !sha.test(c.full_pdf_sha256) ||
      !Number.isInteger(c.expected_page_count) || (c.expected_page_count as number)<1 || (c.expected_page_count as number)>5000 ||
      !text(c.reader_actor,100) || !text(c.reader_run_id,150) || !text(c.reader_verified_at,100) ||
      !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(c.reader_verified_at) ||
      !Number.isFinite(Date.parse(c.reader_verified_at)) || Date.parse(c.reader_verified_at)>(deps.now ?? Date.now())+300_000 ||
      input.pages.length<1 || input.pages.length>5000) fail('catalog_page_contract_invalid');
  try {
    const url = new URL(c.base_url);
    if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash ||
        url.pathname==='/' || ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) fail('catalog_page_source_invalid');
  } catch { return fail('catalog_page_source_invalid'); }
  const numbers = new Set<number>(), documents = new Set<string>(), pages = new Set<string>();
  for (const value of input.pages) {
    if (!object(value) || !exactKeys(value,pageKeys) || !Number.isInteger(value.catalog_page_number) ||
        (value.catalog_page_number as number)<1 || (value.catalog_page_number as number)>(c.expected_page_count as number) ||
        !text(value.document_id,36) || !uuid.test(value.document_id) ||
        !text(value.document_page_id,36) || !uuid.test(value.document_page_id) ||
        !text(value.pdf_sha256,64) || !sha.test(value.pdf_sha256) ||
        !text(value.full_geometry_sha256,64) || !sha.test(value.full_geometry_sha256) ||
        value.full_geometry_sha256!==value.individual_geometry_sha256 ||
        !text(value.full_render_sha256,64) || !sha.test(value.full_render_sha256) ||
        value.full_render_sha256!==value.individual_render_sha256) fail('catalog_page_contract_invalid');
    const n=value.catalog_page_number as number, document=value.document_id.toLowerCase(), page=value.document_page_id.toLowerCase();
    if (numbers.has(n) || documents.has(document) || pages.has(page)) fail('catalog_page_contract_invalid');
    numbers.add(n);documents.add(document);pages.add(page);
  }
  const result=await deps.record(c,input.pages as Obj[]);
  if (!object(result) || result.success!==true || !text(result.catalog_id,36) || !uuid.test(result.catalog_id) ||
      result.pages_submitted!==input.pages.length || !Number.isInteger(result.inserted) || !Number.isInteger(result.replayed) ||
      (result.inserted as number)<0 || (result.replayed as number)<0 ||
      (result.inserted as number)+(result.replayed as number)!==input.pages.length ||
      result.mapping_status!=='client_attested_not_server_reextracted') fail('catalog_page_receipt_invalid',502);
  return { ...result, source_membership_only:true, model_calls:0 };
}
