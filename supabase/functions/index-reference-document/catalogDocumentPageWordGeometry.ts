/** Word geometry for an existing page of a retained whole catalog document. */
import { ReferenceError } from './suppliedReference.ts';
import { recordCatalogPageWordGeometry } from './catalogPageWordGeometry.ts';

type Obj=Record<string,unknown>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(x:unknown):x is Obj{return x!==null && typeof x==='object' && !Array.isArray(x);}
function exact(x:Obj,keys:string[]):boolean{return Object.keys(x).length===keys.length && Object.keys(x).every(k=>keys.includes(k));}
function printable(x:unknown,max:number):x is string{return typeof x==='string' && x.length>0 && x.length<=max && x===x.trim() && /^[\x20-\x7e]+$/.test(x);}
export interface CatalogDocumentPageWordGeometryDeps {
  authorize():Promise<boolean>;
  record(catalogId:string,documentId:string,page:number,pdfSha256:string,geometry:string,version:string,
    actor:string,runId:string,verifiedAt:string):Promise<unknown>;
}
export async function recordCatalogDocumentPageWordGeometry(input:unknown,deps:CatalogDocumentPageWordGeometryDeps) {
  if (!(await deps.authorize())) throw new ReferenceError('catalog_word_service_required',403);
  if (!object(input) || input.mode!=='catalog_document_page_word_geometry' ||
      !exact(input,['mode','catalog_id','document_id','catalog_page_number','pdf_sha256','geometry','extractor_version','reader']) ||
      typeof input.document_id!=='string' || !uuid.test(input.document_id) || !object(input.reader) ||
      !exact(input.reader,['actor','run_id','verified_at']) || !printable(input.reader.actor,100) ||
      !printable(input.reader.run_id,150) || typeof input.reader.verified_at!=='string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.reader.verified_at) ||
      !Number.isFinite(Date.parse(input.reader.verified_at))) {
    throw new ReferenceError('catalog_word_contract_invalid',400);
  }
  const documentId=input.document_id,reader=input.reader as {actor:string;run_id:string;verified_at:string};
  return await recordCatalogPageWordGeometry({mode:'catalog_page_word_geometry',catalog_id:input.catalog_id,
    catalog_page_number:input.catalog_page_number,catalog_edition_sha256:input.pdf_sha256,
    geometry:input.geometry,extractor_version:input.extractor_version},{
      authorize:async()=>true,
      record:(catalogId,page,pdfSha256,geometry,version)=>deps.record(catalogId,documentId,page,pdfSha256,geometry,version,
        reader.actor,reader.run_id,reader.verified_at),
    });
}
