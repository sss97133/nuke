const helloHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hello"))), b => b.toString(16).padStart(2, "0")).join("");
// Actual HTTP handler, real auth guard and SDK; network boundary is synthetic.
import assert from "node:assert/strict";
const owner="11111111-1111-4111-8111-111111111111";
Deno.env.set("SUPABASE_URL","https://financial.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","synthetic-service");
let handler: (req: Request) => Promise<Response>;
const serve=Deno.serve;
(Deno as any).serve=(fn: typeof handler)=>{handler=fn;};
await import("./index.ts");
Deno.serve=serve;
async function run(action: string, scopes: string[], revoke=false, service=false) {
 const originalFetch=globalThis.fetch; let checks=0; const writes: any[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
  const body=typeof init?.body==="string"?JSON.parse(init.body):null;
  const json=(data: unknown)=>new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}});
  if(url.pathname.endsWith("check_api_key_rate_limit")) { checks++; return json({allowed:!(revoke&&checks>1),user_id:owner,scopes,agent_registration_id:"33333333-3333-4333-8333-333333333333"}); }
  if(url.pathname.includes("/bucket/")) return json({id:"user-documents",public:false});
  if(url.pathname.includes("/object/")) return new Response("hello",{headers:{"Content-Type":"application/pdf"}});
  if(url.pathname.endsWith("ingest_financial_evidence")||url.pathname.endsWith("read_financial_evidence")) {writes.push(body);return json({document_id:"synthetic"});}
  throw new Error(`unexpected ${url.pathname}`);
 };
 try {
  const base={mode:"financial_evidence_v1",action};
  const body=action==="read"?{...base,original_sha256:"a".repeat(64)}:{...base,original:{sha256:helloHash,storage_path:`${owner}/proof.pdf`},revision:{}};
  const headers: Record<string,string>={"Content-Type":"application/json"};
  if(service)headers.Authorization="Bearer synthetic-service";else headers["x-api-key"]="nk_live_synthetic";
  const response=await handler!(new Request("https://handler.test",{method:"POST",headers,body:JSON.stringify(body)}));
  return {status:response.status,writes,checks};
 }finally{globalThis.fetch=originalFetch;}
}
Deno.test("financial HTTP: read key uses derived account, write scope cannot read",async()=>{
 const read=await run("read",["read"]);assert.equal(read.status,200);assert.equal(read.writes[0].p_owner_id,owner);
 const denied=await run("read",["write"]);assert.equal(denied.status,403);assert.equal(denied.writes.length,0);
});
Deno.test("financial HTTP: write key admits verified bytes; read key and service refuse",async()=>{
 const write=await run("submit",["write"]);assert.equal(write.status,200);assert.equal(write.writes[0].p_owner_id,owner);assert.equal(write.checks,2);assert.deepEqual(write.writes[0].p_actor_context,{kind:"api_key",agent_id:"33333333-3333-4333-8333-333333333333"});
 assert.equal((await run("submit",["read"])).status,403);
 assert.equal((await run("submit",[],false,true)).status,403);
});
Deno.test("financial HTTP: key revoked during storage read cannot write",async()=>{
 const denied=await run("submit",["write"],true);assert.equal(denied.status,403);assert.equal(denied.writes.length,0);
});
