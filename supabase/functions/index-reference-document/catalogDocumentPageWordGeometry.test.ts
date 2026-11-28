import { recordCatalogDocumentPageWordGeometry } from './catalogDocumentPageWordGeometry.ts';
import { ReferenceError } from './suppliedReference.ts';

const input={mode:'catalog_document_page_word_geometry',catalog_id:'30000000-0000-4000-8000-000000000001',
  document_id:'10000000-0000-4000-8000-000000000001',catalog_page_number:2,pdf_sha256:'f'.repeat(64),
  geometry:JSON.stringify({width:'100',height:'200',words:[['1','2','3','4','word']]}),
  extractor_version:'pdftotext version fixture',reader:{actor:'agent:test',run_id:'fixed-run',verified_at:'2026-01-01T00:00:00Z'}};
function deps(){const calls:unknown[]=[];return {calls,authorize:async()=>true,record:async(...args:unknown[])=>{
  calls.push(args);return {success:true,extraction_id:'40000000-0000-4000-8000-000000000001',
    page_id:'20000000-0000-4000-8000-000000000001',word_count:1,duplicate:false,extractor_version:input.extractor_version,
    geometry_status:'client_attested_not_server_reextracted'};}};}
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function rejects(value:Promise<unknown>,code:string){try{await value;}catch(error){
  if(error instanceof ReferenceError && error.code===code)return;throw error;}throw new Error(`Expected ${code}`);}
Deno.test('whole catalog page geometry authorizes before validation and effects',async()=>{
  const d=deps();d.authorize=async()=>false;
  await rejects(recordCatalogDocumentPageWordGeometry(null,d),'catalog_word_service_required');assert(d.calls.length===0,'unauthorized effect');
});
Deno.test('whole catalog page geometry rejects invented claims and missing attribution',async()=>{
  for(const bad of [{...input,document_id:'bad'},{...input,fitment:'invented'},
    {...input,reader:{...input.reader,actor:''}},{...input,reader:{...input.reader,verified_at:'yesterday'}},
    {...input,reader:{...input.reader,run_id:'bad\nrun'}},{...input,geometry:'not json'},
    {...input,reader:{...input.reader,claims:'invented'}}]){
    const d=deps();await rejects(recordCatalogDocumentPageWordGeometry(bad,d),'catalog_word_contract_invalid');
    assert(d.calls.length===0,'invalid input reached writer');
  }
});
Deno.test('whole catalog page geometry passes exact source and reader attribution',async()=>{
  const d=deps(),result=await recordCatalogDocumentPageWordGeometry(input,d);
  assert(d.calls.length===1 && result.source_geometry_only===true && result.model_calls===0,'incorrect receipt');
  assert(JSON.stringify(d.calls[0])===JSON.stringify([input.catalog_id,input.document_id,2,input.pdf_sha256,input.geometry,
    input.extractor_version,input.reader.actor,input.reader.run_id,input.reader.verified_at]),'changed source or attribution');
});
