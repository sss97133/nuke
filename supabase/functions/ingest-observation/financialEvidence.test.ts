const helloHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hello"))), b => b.toString(16).padStart(2, "0")).join("");
import assert from "node:assert/strict";
function expect(actual: any) { return {
 toBe: (expected: unknown) => assert.equal(actual, expected),
 toBeNull: () => assert.equal(actual, null),
 toHaveLength: (length: number) => assert.equal(actual.length, length),
 toMatchObject: (expected: any) => {
   const check = (a: any, e: any) => { for (const k of Object.keys(e)) {
     if (e[k] && typeof e[k] === "object") check(a[k],e[k]); else assert.equal(a[k],e[k]);
   }}; check(actual,expected);
 },
}; }
import { financialActor, ingestFinancialEvidence } from "./financialEvidence.ts";
const actor = "11111111-1111-4111-8111-111111111111";
const hash = helloHash;
function fixture() {
  const calls: unknown[] = [];
  const db = { storage: {
    getBucket: async () => ({ data: { public: false }, error: null }),
    from: () => ({ download: async () => ({ data: new Blob(["hello"]), error: null }) }),
  }, rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: { document_id: "synthetic" }, error: null }; } };
  const input = { mode: "financial_evidence_v1", original: { sha256: hash, storage_path: `${actor}/proof.pdf` }, revision: {} };
  return { calls, db, input };
}
  Deno.test("requires account identity and action scope; service/anonymous cannot impersonate", () => {
    expect(financialActor({kind:"service_role",userId:actor},"submit")).toBeNull();
    expect(financialActor({kind:"anonymous",userId:actor},"read")).toBeNull();
    expect(financialActor({kind:"api_key",userId:actor,scopes:["read"]},"submit")).toBeNull();
    expect(financialActor({kind:"api_key",userId:actor,scopes:["write"]},"read")).toBeNull();
    expect(financialActor({kind:"api_key",userId:actor,scopes:["write"]},"submit")).toBe(actor);
    expect(financialActor({kind:"api_key",userId:actor,scopes:["read"]},"read")).toBe(actor);
  });
  Deno.test("hashes held bytes and sends only derived account identity", async () => {
    const {db,input,calls}=fixture();
    expect((await ingestFinancialEvidence(db,actor,input,async()=>true)).status).toBe(200);
    expect(calls).toMatchObject([{name:"ingest_financial_evidence",args:{p_owner_id:actor,p_original:{byte_size:5,sha256:hash}}}]);
  });
  Deno.test("rejects foreign original and caller supplied owner", async () => {
    const {db,input,calls}=fixture();
    input.original.storage_path="another-user/proof.pdf";
    expect((await ingestFinancialEvidence(db,actor,input,async()=>true)).status).toBe(400);
    expect((await ingestFinancialEvidence(db,actor,{...input,owner_id:actor},async()=>true)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  Deno.test("refuses public bucket, hash mismatch and revoked account", async () => {
    const {db,input,calls}=fixture();
    db.storage.getBucket=async()=>({data:{public:true},error:null});
    expect((await ingestFinancialEvidence(db,actor,input,async()=>true)).status).toBe(409);
    db.storage.getBucket=async()=>({data:{public:false},error:null});
    expect((await ingestFinancialEvidence(db,actor,input,async()=>false)).status).toBe(403);
    input.original.sha256="a".repeat(64);
    expect((await ingestFinancialEvidence(db,actor,input,async()=>true)).status).toBe(409);
    expect(calls).toHaveLength(0);
  });
  Deno.test("reads a bounded selector as the derived account, refuses owner selector", async () => {
    const {db,calls}=fixture();
    expect((await ingestFinancialEvidence(db,actor,{mode:"financial_evidence_v1",action:"read",original_sha256:hash},async()=>true)).status).toBe(200);
    expect(calls).toMatchObject([{name:"read_financial_evidence",args:{p_owner_id:actor,p_sha256:hash}}]);
    expect((await ingestFinancialEvidence(db,actor,{mode:"financial_evidence_v1",action:"read",original_sha256:hash,owner_id:"other"},async()=>true)).status).toBe(400);
  });
Deno.test("accounting read returns current typed lines and fails closed on reader error", async () => {
  const {db}=fixture(); const names:string[]=[];
  db.rpc=async(name:string,args:unknown)=>{ names.push(name); return { data: name === "read_financial_evidence" ? {document:{id:actor}} : {lines:[{description:"synthetic item"}]},error:null} as any; };
  const result=await ingestFinancialEvidence(db,actor,{action:"read",document_id:actor},async()=>true);
  assert.deepEqual(names,["read_financial_evidence","read_financial_accounting"]);
  assert.deepEqual((result.body as any).data.lines,[{description:"synthetic item"}]);
});
Deno.test("workpaper reads enforce scope and bounded owner-derived pagination", async()=>{
  assert.equal(financialActor({kind:"api_key",userId:actor,scopes:["write"]},"tax_read"),null);
  assert.equal(financialActor({kind:"api_key",userId:actor,scopes:["read"]},"tax_read"),actor);
  const {db,calls}=fixture();
  assert.equal((await ingestFinancialEvidence(db,actor,{action:"tax_read",limit:501},async()=>true)).status,400);
  assert.equal((await ingestFinancialEvidence(db,actor,{action:"tax_read",limit:50},async()=>true)).status,200);
  assert.deepEqual(calls,[{name:"read_financial_tax_workpapers",args:{p_owner_id:actor,p_after:null,p_limit:50}}]);
});
import { cleanPng } from "./financialEvidence.ts";
import { deflateSync } from "node:zlib";
function png(extra=false) {
 const chunk=(type:string,data:Uint8Array)=>{
  const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);
  view.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);
  let crc=0xffffffff;
  for(const byte of out.subarray(4,out.length-4)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;
 };
 const header=new Uint8Array(13); const view=new DataView(header.buffer);view.setUint32(0,1);view.setUint32(4,1);header[8]=8;header[9]=2;
 const pieces=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk("IHDR",header),...(extra?[chunk("tEXt",new TextEncoder().encode("private name"))]:[]),chunk("IDAT",deflateSync(new Uint8Array([0,255,255,255]))),chunk("IEND",new Uint8Array())];
 const out=new Uint8Array(pieces.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of pieces){out.set(p,offset);offset+=p.length;}return out;
}
Deno.test("derivative structure rejects metadata, corruption, dimensions and trailing data",()=>{
 const good=png();assert.equal(cleanPng(good,1,1),true);
 assert.equal(cleanPng(png(true),1,1),false);assert.equal(cleanPng(good,2,1),false);
 const corrupt=good.slice();corrupt[20]^=1;assert.equal(cleanPng(corrupt,1,1),false);
 assert.equal(cleanPng(new Uint8Array([...good,0]),1,1),false);
});
Deno.test("source review verifies actual bytes and ownership before attributed admission",async()=>{
 const {db}=fixture();const bytes=png(),digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
 const source={source_sha256:hash,derivative_sha256:digest,bucket:"user-documents",mime_type:"image/png",storage_path:`${actor}/redacted/${hash}/${digest}.png`,width:1,height:1,verification:{reviewer:actor,reviewed_at:"2026-01-01T00:00:00Z"}};
 const calls:string[]=[];
 db.storage.from=()=>({download:async()=>({data:new Blob([bytes]),error:null})});
 db.rpc=async(name:string)=>{calls.push(name);return {data:name==="read_financial_evidence"?{document:{id:actor,content_sha256:hash}}:{extraction_id:actor},error:null} as any;};
 assert.equal((await ingestFinancialEvidence(db,actor,{action:"review_source",document_id:actor,source},async()=>false)).status,403);
 assert.deepEqual(calls,["read_financial_evidence"]);
 assert.equal((await ingestFinancialEvidence(db,actor,{action:"review_source",document_id:actor,source},async()=>true)).status,200);
 assert.equal(calls.at(-1),"record_financial_source_review");
 source.verification.reviewer="another-account";
 assert.equal((await ingestFinancialEvidence(db,actor,{action:"review_source",document_id:actor,source},async()=>true)).status,400);
 source.verification.reviewer=actor;
 source.storage_path=`other/redacted/${hash}/${digest}.png`;
 assert.equal((await ingestFinancialEvidence(db,actor,{action:"review_source",document_id:actor,source},async()=>true)).status,400);
});
