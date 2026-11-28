/** Service-only, client-attested word geometry on an existing catalog page. */
import { ReferenceError } from './suppliedReference.ts';

type Obj = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
function fail(code: string, status = 400): never { throw new ReferenceError(code, status); }
function object(value: unknown): value is Obj { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Obj, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
export interface CatalogPageWordGeometryDeps {
  authorize(): Promise<boolean>;
  record(catalogId: string, page: number, edition: string, geometry: string, extractorVersion: string): Promise<unknown>;
}
export async function recordCatalogPageWordGeometry(input: unknown, deps: CatalogPageWordGeometryDeps) {
  if (!(await deps.authorize())) fail('catalog_word_service_required',403);
  if (!object(input) || input.mode !== 'catalog_page_word_geometry' ||
      !exact(input,['mode','catalog_id','catalog_page_number','catalog_edition_sha256','geometry','extractor_version']) ||
      typeof input.catalog_id !== 'string' || !uuid.test(input.catalog_id) ||
      !Number.isInteger(input.catalog_page_number) || (input.catalog_page_number as number)<1 ||
      (input.catalog_page_number as number)>5000 || typeof input.catalog_edition_sha256 !== 'string' ||
      !sha.test(input.catalog_edition_sha256) || typeof input.extractor_version!=='string' ||
      input.extractor_version.length<1 || input.extractor_version.length>200 || input.extractor_version!==input.extractor_version.trim() ||
      /[\u0000-\u001f\u007f]/.test(input.extractor_version) || typeof input.geometry !== 'string' ||
      new TextEncoder().encode(input.geometry).length>1048576) fail('catalog_word_contract_invalid');
  let geometry: unknown;
  try { geometry=JSON.parse(input.geometry); } catch { return fail('catalog_word_contract_invalid'); }
  if (!object(geometry) || !exact(geometry,['width','height','words']) ||
      typeof geometry.width !== 'string' || typeof geometry.height !== 'string' ||
      !Array.isArray(geometry.words) || geometry.words.length>5000 ||
      geometry.words.some(w => !Array.isArray(w) || w.length!==5 ||
        w.some((value:unknown) => typeof value!=='string') || !w[4] || w[4].length>4000)) {
    fail('catalog_word_contract_invalid');
  }
  const result=await deps.record(input.catalog_id,input.catalog_page_number as number,input.catalog_edition_sha256,input.geometry,input.extractor_version);
  if (!object(result) || result.success!==true || typeof result.extraction_id!=='string' || !uuid.test(result.extraction_id) ||
      typeof result.page_id!=='string' || !uuid.test(result.page_id) || result.word_count!==geometry.words.length ||
      result.extractor_version!==input.extractor_version || typeof result.duplicate!=='boolean' ||
      result.geometry_status!=='client_attested_not_server_reextracted') {
    fail('catalog_word_receipt_invalid',502);
  }
  return { ...result, source_geometry_only:true, model_calls:0 };
}
