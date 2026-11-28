import { recordCatalogPageMembership } from './catalogPageMembership.ts';
import { ReferenceError } from './suppliedReference.ts';

const catalog={name:'Synthetic SUV catalog',provider:'LMC',base_url:'https://example.test/suv/full.pdf',
  full_pdf_sha256:'f'.repeat(64),expected_page_count:220,reader_actor:'agent:test',reader_run_id:'fixed',
  reader_verified_at:'2026-01-01T00:00:00Z'};
const page={catalog_page_number:11,document_id:'10000000-0000-4000-8000-000000000011',
  document_page_id:'20000000-0000-4000-8000-000000000011',pdf_sha256:'1'.repeat(64),
  full_geometry_sha256:'7'.repeat(64),individual_geometry_sha256:'7'.repeat(64),
  full_render_sha256:'8'.repeat(64),individual_render_sha256:'8'.repeat(64)};
const input={mode:'catalog_page_membership',catalog,pages:[page]};
function deps(){const calls:unknown[]=[];return {calls,authorize:async()=>true,record:async(c:Record<string,unknown>,p:Record<string,unknown>[])=>{
  calls.push({c,p});return {success:true,catalog_id:'30000000-0000-4000-8000-000000000001',pages_submitted:1,
    inserted:1,replayed:0,mapping_status:'client_attested_not_server_reextracted'};}};}
function assert(v:unknown,message:string):asserts v {if(!v)throw new Error(message);}
async function rejects(p:Promise<unknown>,code:string){try{await p;}catch(e){if(e instanceof ReferenceError && e.code===code)return;throw e;}throw new Error(`Expected ${code}`);}

Deno.test('page membership requires service authority before writer',async()=>{
  const d=deps();d.authorize=async()=>false;
  await rejects(recordCatalogPageMembership(input,d),'catalog_page_service_required');assert(d.calls.length===0,'unauthorized writer call');
});
Deno.test('page membership rejects unsafe catalog and page contracts',async()=>{
  for(const bad of [
    {...input,catalog:{...catalog,expected_page_count:0}}, {...input,catalog:{...catalog,reader_verified_at:'2099-01-01T00:00:00Z'}},
    {...input,catalog:{...catalog,full_pdf_sha256:'bad'}}, {...input,catalog:{...catalog,extra:true}},
    {...input,pages:[]}, {...input,pages:[page,page]}, {...input,pages:[{...page,catalog_page_number:221}]},
    {...input,pages:[{...page,document_id:'not-a-uuid'}]}, {...input,pages:[{...page,individual_geometry_sha256:'0'.repeat(64)}]},
    {...input,pages:[{...page,individual_render_sha256:'0'.repeat(64)}]}, {...input,pages:[{...page,extra:'untrusted'}]},
  ]){const d=deps();await rejects(recordCatalogPageMembership(bad,d),'catalog_page_contract_invalid');assert(d.calls.length===0,'bad contract reached writer');}
  for(const base_url of ['http://example.test/full.pdf','https://u:p@example.test/full.pdf','https://example.test/full.pdf?x=1','https://localhost/a.pdf']){
    const d=deps();await rejects(recordCatalogPageMembership({...input,catalog:{...catalog,base_url}},d),'catalog_page_source_invalid');
  }
});
Deno.test('page membership reports only client-attested source relationship',async()=>{
  const d=deps(), result=await recordCatalogPageMembership(input,d);
  assert(d.calls.length===1 && result.source_membership_only===true && result.model_calls===0,'incorrect membership receipt');
  assert((result as Record<string,unknown>).mapping_status==='client_attested_not_server_reextracted','client attestation omitted');
});
Deno.test('page membership rejects malformed writer receipts',async()=>{
  const d=deps();d.record=async()=>({success:true,catalog_id:'bad',pages_submitted:1,inserted:1,replayed:0,
    mapping_status:'client_attested_not_server_reextracted'});
  await rejects(recordCatalogPageMembership(input,d),'catalog_page_receipt_invalid');
});
