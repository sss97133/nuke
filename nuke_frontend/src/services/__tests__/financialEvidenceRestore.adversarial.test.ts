// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { validateFinancialRestoreBundle } from '../financialEvidenceRestore';
import { createHash } from 'node:crypto';
const sha = createHash('sha256').update('a').digest('hex');
const field = () => ({ field_key: 'capture_status', value_raw: 'captured', evidence: { source_sha256: sha } });
const revision = () => ({ idempotency_key: 'r1', method: 'retained', version: '1', fields: [field()] });
const bundle = () => ({ contract: 'financial_evidence_restore_v1', items: [{ original: { sha256: sha, source_filename: 'source.csv', source_kind: 'bank_export', base64: 'YQ==' }, revisions: [{ local_ref: 'r1', supersedes_local_ref: null as string | null, revision: revision() as Record<string, any> }] }] });
const file = (value: unknown) => { const text = JSON.stringify(value); return { size: Buffer.byteLength(text), text: async () => text } as File; };
describe('restore complete preflight independent regressions', () => {
 it('accepts a bounded synthetic bundle', async () => { expect(await validateFinancialRestoreBundle(file(bundle()))).toHaveLength(1); });
 it('rejects concerns exceeding the server limit before restore', async () => {
   const b=bundle(); b.items[0].revisions[0].revision.concerns=Array.from({length:31},()=>({concern_type:'piece_illisible',resolver:'owner'}));
   await expect(validateFinancialRestoreBundle(file(b))).rejects.toThrow();
 });
 it('rejects reserved private OCR nested in cell evidence', async () => {
   const b=bundle(); b.items[0].revisions[0].revision.fields[0].evidence.ocr_text='private OCR';
   await expect(validateFinancialRestoreBundle(file(b))).rejects.toThrow();
 });
 it('rejects an incomplete later snapshot before any first revision admission', async () => {
   const b=bundle();b.items[0].revisions.push({local_ref:'r2',supersedes_local_ref:'r1',revision:{...revision(),idempotency_key:'r2',fields:[{...field(),field_key:'other'}]}});
   await expect(validateFinancialRestoreBundle(file(b))).rejects.toThrow();
 });
 it('rejects a chain exceeding the per-original 100 revision limit', async () => {
   const b=bundle();b.items[0].revisions=Array.from({length:101},(_,i)=>({local_ref:`r${i}`,supersedes_local_ref:i?`r${i-1}`:null,revision:{...revision(),idempotency_key:`r${i}`}}));
   await expect(validateFinancialRestoreBundle(file(b))).rejects.toThrow();
 });
 it('checks UTF8 evidence bytes instead of JS character count', async () => {
   const b=bundle();b.items[0].revisions[0].revision.fields[0].evidence={note:'é'.repeat(1995)};
   await expect(validateFinancialRestoreBundle(file(b))).rejects.toThrow();
 });
});
it('rejects the same current accounting source admitted through two originals', async()=>{
 const b=bundle();
 const record={record_kind:'retained_bank_movement',source_key:'c'.repeat(64),source_sha256:'d'.repeat(64),source_row:1,local_id:'bank-1',year:'2024',date:'2024-01-01',account:'checking',currency:'USD',currency_basis:'source statement',amount:'-1.00',section:'Bank movement',category:null,description:'synthetic',decision:null,status:null,source_reference:null,bank_links:[],recognition_status:'not_applicable',payment_status:'unresolved',vehicle_status:'unresolved',reimbursement_status:'unresolved',entity_status:'retained_scope_unallocated'};
 b.items[0].revisions[0].revision.accounting_records=[record];
 b.items.push({original:{...b.items[0].original,base64:'Yg==',sha256:createHash('sha256').update('b').digest('hex')},revisions:[{local_ref:'other',supersedes_local_ref:null,revision:{...revision(),idempotency_key:'other',accounting_records:[record]}}]});
 expect(await validateFinancialRestoreBundle(file(b)).then(()=>false,()=>true)).toBe(true);
});
it('rejects PostgreSQL-incompatible null bytes and integer-overflow page numbers',async()=>{
 const nul=bundle();nul.items[0].revisions[0].revision.fields[0].value_raw='private\u0000text';
 expect(await validateFinancialRestoreBundle(file(nul)).then(()=>false,()=>true)).toBe(true);
 const page=bundle();page.items[0].revisions[0].revision.fields[0].page_number=2147483648;
 expect(await validateFinancialRestoreBundle(file(page)).then(()=>false,()=>true)).toBe(true);
});
it('validates multi-megabyte original bytes without recursive regex stack exhaustion', async()=>{
 const bytes=Buffer.alloc(3*1024*1024+1,97),b=bundle();
 const originalSha=createHash('sha256').update(bytes).digest('hex');
 b.items[0].original={...b.items[0].original,sha256:originalSha,source_filename:'large.jpeg',base64:bytes.toString('base64')};
 b.items[0].revisions[0].revision.fields[0].evidence={source_sha256:originalSha};
 const items=await validateFinancialRestoreBundle(file(b));
 expect(items[0].bytes.length).toBe(bytes.length);
 expect(Buffer.compare(Buffer.from(items[0].bytes),bytes)).toBe(0);
});
it('rejects invalid base64 length, interior/excess padding and alphabet',async()=>{
 for(const encoded of ['YQ=','Y=Q=','YQ====','Y?==','====']){
   const b=bundle();b.items[0].original.base64=encoded;
   expect(await validateFinancialRestoreBundle(file(b)).then(()=>false,()=>true)).toBe(true);
 }
});
