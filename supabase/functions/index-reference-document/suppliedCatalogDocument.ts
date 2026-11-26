import { ReferenceError, sha256 } from './suppliedReference.ts';
type Obj = Record<string, any>;
export const CATALOG_SOURCE_MODE = 'supplied_catalog_source';
const maxBytes = 262144;
const fail = (code: string, status = 400): never => { throw new ReferenceError(code, status); };
export async function validateCatalogDocument(input: unknown, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('catalog_document_required');
  const x = input as Obj, d = x.document;
  if (Object.keys(x).some(k => !['mode','document','body_base64'].includes(k)) || x.mode !== CATALOG_SOURCE_MODE ||
    !d || typeof d !== 'object' || Array.isArray(d) ||
    Object.keys(d).some(k => !['title','source_url','file_sha256','claimed_captured_at','media_type'].includes(k)) ||
    d.media_type !== 'text/markdown' || typeof d.title !== 'string' || !d.title.trim() || d.title.length > 500 ||
    typeof d.file_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(d.file_sha256)) fail('catalog_document_invalid');
  let url: URL;
  try { url = new URL(d.source_url); } catch { fail('catalog_source_url_invalid'); }
  if (url!.protocol !== 'https:' || url!.username || url!.password || url!.search || url!.hash ||
    ['localhost','127.0.0.1','[::1]'].includes(url!.hostname)) fail('catalog_source_url_invalid');
  if (d.claimed_captured_at !== null && (typeof d.claimed_captured_at !== 'string' ||
    !/^\d{4}-\d\d-\d\dT/.test(d.claimed_captured_at) || !Number.isFinite(Date.parse(d.claimed_captured_at)) ||
    Date.parse(d.claimed_captured_at) > now + 300000)) fail('catalog_capture_clock_invalid');
  if (typeof x.body_base64 !== 'string' || x.body_base64.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(x.body_base64)) fail('catalog_body_encoding_invalid');
  let bytes: Uint8Array, body: string;
  try {
    bytes = Uint8Array.from(atob(x.body_base64), c => c.charCodeAt(0));
    body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch { fail('catalog_body_utf8_required'); }
  if (bytes!.length === 0 || bytes!.length > maxBytes || body!.includes('\0') ||
    await sha256(bytes!) !== d.file_sha256) fail('catalog_body_hash_or_bytes_invalid');
  return { document: d, bytes: bytes!, body: body! };
}
export interface CatalogDocumentDeps {
  authorize(): Promise<boolean>;
  retain(bytes: Uint8Array, hash: string): Promise<void>;
  record(document: Obj, body: string): Promise<Obj>;
  ingest(selector: Obj): Promise<Obj>;
  now?: number;
}
export async function recordSuppliedCatalogDocument(input: unknown, deps: CatalogDocumentDeps) {
  if (!await deps.authorize()) fail('catalog_service_required', 403);
  const v = await validateCatalogDocument(input, deps.now);
  await deps.retain(v.bytes, v.document.file_sha256);
  const doc = await deps.record(v.document, v.body);
  if (!doc?.success || !/^[0-9a-f-]{36}$/.test(doc.document_id) || doc.file_hash !== v.document.file_sha256)
    fail('catalog_document_not_persisted', 502);
  const landed = await deps.ingest({ mode: 'catalog_source_document', document_id: doc.document_id });
  if (!landed?.success || !/^[0-9a-f-]{36}$/.test(landed.observation_id)) fail('catalog_source_not_admitted', 409);
  return { success: true, document_id: doc.document_id, source_observation_id: landed.observation_id,
    duplicate: landed.duplicate === true, authority: 'supplied_document_unverified',
    purchasing_eligible: false, model_calls: 0 };
}
