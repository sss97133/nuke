// @vitest-environment node
import { beforeEach, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),onAuthStateChange:vi.fn(),upload:vi.fn(),invoke:vi.fn(),unsubscribe:vi.fn()}));
vi.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:mocks.getUser,onAuthStateChange:mocks.onAuthStateChange},storage:{from:()=>({upload:mocks.upload})},functions:{invoke:mocks.invoke}}}));
import {restoreFinancialEvidence} from '../financialEvidenceRestore';
const owner='11111111-1111-4111-8111-111111111111',doc='22222222-2222-4222-8222-222222222222',run='33333333-3333-4333-8333-333333333333';
const sha=createHash('sha256').update('a').digest('hex');
let listener:(_:string,session:any)=>void;
const bundle=()=>({contract:'financial_evidence_restore_v1',items:[{original:{sha256:sha,source_filename:'source.csv',source_kind:'bank_export',base64:'YQ=='},revisions:[{local_ref:'r1',supersedes_local_ref:null,revision:{idempotency_key:'r1',method:'retained',version:'1',fields:[{field_key:'amount',value_raw:'1.00',value_normalized:'1.00',value_type:'amount',evidence:{source_sha256:sha}}]}}]}]});
const file=(b:unknown)=>{const text=JSON.stringify(b);return {size:Buffer.byteLength(text),text:async()=>text} as File;};
beforeEach(()=>{vi.resetAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:owner,is_anonymous:false}},error:null});mocks.onAuthStateChange.mockImplementation((fn)=>{listener=fn;return {data:{subscription:{unsubscribe:mocks.unsubscribe}}};});mocks.upload.mockResolvedValue({error:null});mocks.invoke.mockImplementation(async(_name,options)=>options.body.action==='submit'?{data:{data:{document_id:doc,extraction_run_id:run}},error:null}:{data:{data:{document:{id:doc,content_sha256:sha},fields:[{field_key:'amount',value_raw:'CORRUPTED',value_normalized:{value:'999.00'},extraction_run_id:run,is_superseded:false}],lines:[]}},error:null});});
it('invalid final bundle item causes zero uploads and admissions',async()=>{const b=bundle();b.items.push({...b.items[0],original:{...b.items[0].original,sha256:'b'.repeat(64)}});await expect(restoreFinancialEvidence(file(b))).rejects.toThrow();expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.invoke).not.toHaveBeenCalled();});
it('owner change during upload prevents any admission',async()=>{mocks.upload.mockImplementation(async()=>{listener('SIGNED_OUT',null);return {error:null};});await expect(restoreFinancialEvidence(file(bundle()))).rejects.toThrow();expect(mocks.invoke).not.toHaveBeenCalled();expect(mocks.unsubscribe).toHaveBeenCalled();});
it('anonymous session cannot upload retained financial evidence',async()=>{mocks.getUser.mockResolvedValue({data:{user:{id:owner,is_anonymous:true}},error:null});await expect(restoreFinancialEvidence(file(bundle()))).rejects.toThrow();expect(mocks.upload).not.toHaveBeenCalled();});
it('matching run and hash cannot hide corrupted current field content',async()=>{await expect(restoreFinancialEvidence(file(bundle()))).rejects.toThrow();expect(mocks.invoke).toHaveBeenCalledTimes(2);});
