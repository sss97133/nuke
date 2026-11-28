import { recordCatalogPageWordGeometry } from './catalogPageWordGeometry.ts';
import { ReferenceError } from './suppliedReference.ts';

const input={mode:'catalog_page_word_geometry',catalog_id:'30000000-0000-4000-8000-000000000001',
  catalog_page_number:20,catalog_edition_sha256:'f'.repeat(64),extractor_version:'pdftotext version fixture',
  geometry:JSON.stringify({width:'100',height:'200',words:[['-0.64','1','4','5','cover'],['1','2','3','4','38-2971-BL']]})};
function deps(){const calls:unknown[]=[];return {calls,authorize:async()=>true,record:async(...args:unknown[])=>{
  calls.push(args);return {success:true,extraction_id:'40000000-0000-4000-8000-000000000001',
    page_id:'20000000-0000-4000-8000-000000000001',word_count:2,duplicate:false,extractor_version:input.extractor_version,
    geometry_status:'client_attested_not_server_reextracted'};}};}
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
async function rejects(value:Promise<unknown>,code:string){try{await value;}catch(error){
  if(error instanceof ReferenceError && error.code===code)return;throw error;}throw new Error(`Expected ${code}`);}

Deno.test('word geometry requires service authority before writer',async()=>{
  const d=deps();d.authorize=async()=>false;
  await rejects(recordCatalogPageWordGeometry(input,d),'catalog_word_service_required');assert(d.calls.length===0,'unauthorized writer call');
});
Deno.test('word geometry rejects malformed envelopes and invented claims',async()=>{
  for(const bad of [
    {...input,catalog_id:'invalid'}, {...input,catalog_page_number:0}, {...input,catalog_edition_sha256:'bad'}, {...input,extractor_version:''},
    {...input,geometry:'not-json'}, {...input,geometry:JSON.stringify({width:'1',height:'2',words:[],fitment:'invented'})},
    {...input,geometry:JSON.stringify({width:'1',height:'2',words:[['1','2','3','4',123]]})},
    {...input,geometry:JSON.stringify({width:'1',height:'2',words:[['1','2','3','4','']]})},
    {...input,fitment:'invented'},
  ]){const d=deps();await rejects(recordCatalogPageWordGeometry(bad,d),'catalog_word_contract_invalid');assert(d.calls.length===0,'invalid input reached writer');}
});
Deno.test('word geometry retains the attributed source shape only',async()=>{
  const d=deps(), result=await recordCatalogPageWordGeometry(input,d);
  assert(d.calls.length===1 && result.source_geometry_only===true && result.model_calls===0,'incorrect receipt');
  assert((result as Record<string,unknown>).geometry_status==='client_attested_not_server_reextracted','client attestation missing');
});
Deno.test('word geometry rejects a wrong source-writer receipt',async()=>{
  const d=deps();d.record=async()=>({success:true,extraction_id:'bad',page_id:'bad',word_count:2,duplicate:false,extractor_version:input.extractor_version,
    geometry_status:'client_attested_not_server_reextracted'});
  await rejects(recordCatalogPageWordGeometry(input,d),'catalog_word_receipt_invalid');
});
