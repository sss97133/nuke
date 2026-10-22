import assert from 'node:assert/strict';
import { callAccounting } from './accountingTools.ts';
Deno.test('MCP preserves caller credential and returns image content without a base64 text wall',async()=>{
 const old=globalThis.fetch;let forwarded:RequestInit|undefined;
 globalThis.fetch=async(_input,init)=>{forwarded=init;return Response.json({data:{document_id:'synthetic',mime_type:'image/png',bytes_base64:'cHJvb2Y='}});};
 try { const result=await callAccounting(new Request('https://example.test',{headers:{authorization:'Bearer caller'}}),{action:'original',owner_user_id:'owner'},'https://example.test');
 assert.equal(new Headers(forwarded?.headers).get('authorization'),'Bearer caller');assert.equal(JSON.parse(String(forwarded?.body)).mode,'financial_evidence_v1');assert.equal(result.content[1].type,'image');assert.ok(!JSON.stringify(result.content[0]).includes('cHJvb2Y='));
 }finally{globalThis.fetch=old;}
});
