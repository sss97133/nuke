import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const f = vi.hoisted(() => ({ user: 'owner-a', calls: [] as any[], uploaded: [] as string[], existing: false, processed: false, uploadError: null as any, changeAfterUpload: false }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: f.user ? { id: f.user } : null }, error: null }) },
  storage: { from: () => ({ upload: async (path: string) => { f.uploaded.push(path); if(f.changeAfterUpload) f.user='owner-b'; return { error: f.uploadError }; } }) },
  functions: { invoke: async (_name: string, { body }: any) => {
    f.calls.push(body);
    if(body.action==='process') { f.processed=true; return {data:{processing_status:'needs_review'},error:null}; }
    return { data: { data: f.existing || f.processed ? { document: { id:'doc-a' }, fields: [] } : null }, error: null };
  } },
} }));
import { processFinancialDocument, processExistingFinancialDocument } from '../financialEvidenceIntake';
function file() { return { name:'scan.jpg', size:3, type:'image/jpeg', arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer } as File; }
beforeEach(()=>{ f.user='owner-a';f.calls=[];f.uploaded=[];f.existing=false;f.processed=false;f.uploadError=null;f.changeAfterUpload=false; vi.stubGlobal('crypto',webcrypto); });
describe('signed-in financial intake',()=>{
  it('uploads privately then processes and verifies with normal session',async()=>{
    const r=await processFinancialDocument(file());
    expect(f.uploaded[0]).toMatch(/^owner-a\/financial\/[a-f0-9]{64}\.jpg$/);
    expect(f.calls.map(x=>x.action)).toEqual(['read','process','read']);
    expect(r.status).toBe('needs_review');expect(r.documentId).toBe('doc-a');
    expect(JSON.stringify(f.calls)).not.toContain('api_key');
  });
  it('reuses retained evidence instead of reuploading',async()=>{
    f.existing=true;const r=await processFinancialDocument(file());expect(f.uploaded).toEqual([]);expect(r.reused).toBe(true);expect(r.status).toBe('needs_review');expect(f.calls.map(x=>x.action)).toEqual(['read','process','read']);
  });
  it('resumes owned retained documents without accessing or uploading files',async()=>{
    const r=await processExistingFinancialDocument('doc-a');expect(f.uploaded).toEqual([]);expect(f.calls.map(x=>x.action)).toEqual(['process','read']);expect(r.reused).toBe(true);
  });
  it('refuses signed-out users before any upload or invocation',async()=>{
    f.user='';await expect(processFinancialDocument(file())).rejects.toThrow('Sign in');expect(f.calls).toEqual([]);expect(f.uploaded).toEqual([]);
  });
  it('stops processing when account changes during upload',async()=>{
    f.changeAfterUpload=true;await expect(processFinancialDocument(file())).rejects.toThrow('Sign in');expect(f.calls.map(x=>x.action)).toEqual(['read']);
  });
  it('retries an upload conflict through server hash verification',async()=>{
    f.uploadError={statusCode:'409'};const r=await processFinancialDocument(file());expect(r.documentId).toBe('doc-a');expect(f.calls.some(x=>x.action==='process')).toBe(true);
  });
  it('does not process failed uploads',async()=>{
    f.uploadError={statusCode:'403'};await expect(processFinancialDocument(file())).rejects.toThrow('upload failed');expect(f.calls.map(x=>x.action)).toEqual(['read']);
  });
});
