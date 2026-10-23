import assert from 'node:assert/strict';
import { delegatedFinancialEvidence } from './financialDelegation.ts';
const actor='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333',doc='44444444-4444-4444-8444-444444444444';
const caller={kind:'api_key',userId:actor,keyId:key,scopes:['accounting:read','accounting:correct']};
const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('proof'))),b=>b.toString(16).padStart(2,'0')).join('');
function fixture() {
 const calls:{name:string,args:Record<string,unknown>}[]=[];let active=true;
 const db={storage:{getBucket:async()=>({data:{public:false},error:null}),from:()=>({download:async()=>({data:new Blob(['proof'],{type:'application/pdf'}),error:null})})},rpc:async(name:string,args:Record<string,unknown>)=>{
 calls.push({name,args});
 if(name==='authorize_financial_access')return {data:{allowed:active,grant_id:doc},error:active?null:'revoked'};
 if(name==='read_financial_evidence')return {data:{document:{id:doc,owner_id:owner,storage_path:`${owner}/proof.pdf`,content_sha256:hash}},error:null};
 return {data:{records:[]},error:null};
 }};
 return {db,calls,revoke:()=>{active=false;}};
}
Deno.test('derived actor/key/target grant checked on read and again before returning',async()=>{
 const f=fixture();const result=await delegatedFinancialEvidence(f.db,caller,{action:'tax_read',owner_user_id:owner},async()=>caller);
 assert.equal(result.status,200);assert.equal(f.calls.filter(c=>c.name==='authorize_financial_access').length,2);
 assert.deepEqual(f.calls[0].args,{p_actor_id:actor,p_owner_id:owner,p_key_id:key,p_operation:'read'});
});
Deno.test('read scope cannot correct; forged actor fields never reach writer',async()=>{
 const f=fixture();assert.equal((await delegatedFinancialEvidence(f.db,{...caller,scopes:['accounting:read']},{action:'correct',owner_user_id:owner},async()=>caller)).status,403);
 assert.equal((await delegatedFinancialEvidence(f.db,caller,{action:'tax_read',owner_user_id:owner,actor_user_id:owner},async()=>caller)).status,400);
 assert.ok(!f.calls.some(c=>c.name==='ingest_financial_evidence'));
});
Deno.test('revocation during original download withholds bytes',async()=>{
 const f=fixture();f.db.storage.from=()=>({download:async()=>{f.revoke();return {data:new Blob(['proof']),error:null};}});
 const result=await delegatedFinancialEvidence(f.db,caller,{action:'original',owner_user_id:owner,document_id:doc},async()=>caller);
 assert.equal(result.status,403);assert.ok(!('data' in result.body));
});
Deno.test('original uses stored owner path and verifies hash; credential replacement refused',async()=>{
 const f=fixture();assert.equal((await delegatedFinancialEvidence(f.db,caller,{action:'original',owner_user_id:owner,document_id:doc},async()=>caller)).status,200);
 assert.equal((await delegatedFinancialEvidence(f.db,caller,{action:'read',owner_user_id:owner,document_id:doc},async()=>({...caller,keyId:doc}))).status,403);
});
Deno.test('correction forwards only server-derived attribution and explicit supersession',async()=>{
 const f=fixture();const result=await delegatedFinancialEvidence(f.db,caller,{action:'correct',owner_user_id:owner,original:{sha256:hash,storage_path:`${owner}/proof.pdf`},revision:{supersedes_run_id:doc}},async()=>caller);
 assert.equal(result.status,200);assert.deepEqual(f.calls.find(c=>c.name==='ingest_financial_evidence')?.args.p_actor_context,{kind:'api_key',agent_id:undefined,actor_user_id:actor,owner_user_id:owner,key_id:key,grant_id:doc});
});
