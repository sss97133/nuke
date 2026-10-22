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
