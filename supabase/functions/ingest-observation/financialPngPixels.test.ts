import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { cleanPng, ingestFinancialEvidence } from "./financialEvidence.ts";
const owner = "11111111-1111-4111-8111-111111111111", original = "a".repeat(64);
function png(compressed: Uint8Array) {
  function chunk(type: string, data: Uint8Array) {
    const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
    view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
    let crc = 0xffffffff;
    for (const b of out.subarray(4, out.length - 4)) { crc ^= b; for (let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
    view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0); return out;
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 1); view.setUint32(4, 1); header[8]=8; header[9]=2;
  const parts = [new Uint8Array([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",compressed),chunk("IEND",new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let offset=0;
  for(const part of parts){out.set(part,offset);offset+=part.length;} return out;
}
async function review(compressed: Uint8Array) {
  const bytes=png(compressed); assert.equal(cleanPng(bytes,1,1),true,"valid structure isolates pixel decoder");
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  const calls: string[]=[];
  const db={storage:{getBucket:async()=>({data:{public:false},error:null}),from:()=>({download:async()=>({data:new Blob([bytes]),error:null})})},
    rpc:async(name:string)=>{calls.push(name);return {data:name==="read_financial_evidence"?{document:{id:owner,content_sha256:original}}:{extraction_id:owner},error:null};}};
  const result=await ingestFinancialEvidence(db,owner,{action:"review_source",document_id:owner,source:{
    source_sha256:original,derivative_sha256:digest,bucket:"user-documents",mime_type:"image/png",
    storage_path:`${owner}/redacted/${original}/${digest}.png`,width:1,height:1,
    verification:{reviewer:owner,reviewed_at:"2026-10-22T12:00:00Z"}}},async()=>true);
  return {result,calls};
}
Deno.test("source review refuses malformed zlib despite valid PNG CRC and source hash",async()=>{
  const {result,calls}=await review(new Uint8Array([1,2,3,4])); assert.equal(result.status,409);assert.deepEqual(calls,["read_financial_evidence"]);
});
Deno.test("source review bounds inflated raster to declared dimensions",async()=>{
  const {result,calls}=await review(deflateSync(new Uint8Array(1024*1024)));assert.equal(result.status,409);assert.deepEqual(calls,["read_financial_evidence"]);
});
Deno.test("source review refuses truncated raster and invalid row filter",async()=>{
  for(const rows of [new Uint8Array([0,255,255]),new Uint8Array([5,255,255,255])]){
    const {result,calls}=await review(deflateSync(rows));assert.equal(result.status,409);assert.deepEqual(calls,["read_financial_evidence"]);
  }
});
Deno.test("source review admits exactly sized valid RGB scanline",async()=>{
  const {result,calls}=await review(deflateSync(new Uint8Array([0,255,255,255])));assert.equal(result.status,200);assert.equal(calls.at(-1),"record_financial_source_review");
});
Deno.test("source review refuses bytes hidden after compressed raster stream",async()=>{
  const compressed=deflateSync(new Uint8Array([0,255,255,255]));
  const {result,calls}=await review(new Uint8Array([...compressed,...new TextEncoder().encode("hidden private text")]));
  assert.equal(result.status,409);assert.deepEqual(calls,["read_financial_evidence"]);
});
