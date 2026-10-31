#!/usr/bin/env node
// Manual bounded replay through the canonical writer. No source fetch, queue mutation or paid inference.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function parseArgs(args) {
  const ids=[]; let apply=false;
  for(let i=0;i<args.length;i++) {
    const a=args[i];
    if(a==='--apply') apply=true;
    else if(a==='--snapshot') ids.push(args[++i]);
    else if(a==='--manifest') {
      const rows=JSON.parse(readFileSync(args[++i],'utf8'));
      if(!Array.isArray(rows)||rows.some(r=>typeof r!=='string')) throw Error('Manifest must be an array of snapshot UUID strings');
      ids.push(...rows);
    } else throw Error('Usage: ecr-retained-replay.mjs --snapshot UUID [--snapshot UUID ...] [--manifest FILE] [--apply]');
  }
  if(ids.length<1||ids.length>50||ids.some(id=>typeof id!=='string'||! /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
    throw Error('Select 1–50 explicit retained snapshot UUIDs; default is dry-run');
  if(new Set(ids.map(id=>id.toLowerCase())).size!==ids.length) throw Error('Duplicate snapshot selectors');
  return {ids:ids.map(id=>id.toLowerCase()),apply};
}
export async function replay({ids,apply}, {base,key,send=fetch,report=console.log}) {
  if(!base||!key) throw Error('Configured server-side Supabase credentials required');
  const origin=new URL(base);
  if(origin.protocol!=='https:'||!origin.hostname.endsWith('.supabase.co')||origin.username||origin.password) throw Error('Expected configured Supabase HTTPS origin');
  const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:`Bearer ${key}`} : {}),'Content-Type':'application/json'};
  const receipts=[];
  for(const id of ids) {
    const response=await send(new URL('/functions/v1/ingest-observation',origin),{method:'POST',headers,
      body:JSON.stringify({mode:'retained_ecr_capture_v1',snapshot_id:id,dry_run:!apply}),signal:AbortSignal.timeout(30000)});
    const result=await response.json();
    if(!response.ok||result.success!==true) {
      const r={snapshot_id:id,status:'refused',reason:result.reason||result.error||`http_${response.status}`};receipts.push(r);report(JSON.stringify(r));continue;
    }
    if(!apply) {
      if(result.dry_run!==true||result.writes!==0||result.model_calls!==0||result.receipt?.snapshot_id!==id) throw Error('Unconfirmed dry-run response');
      const r={snapshot_id:id,status:'qualified',kind:result.receipt.kind,cards:result.receipt.cards.length,writes:0};receipts.push(r);report(JSON.stringify(r));continue;
    }
    if(typeof result.observation_id!=='string'||result.snapshot_id!==id||result.resolution_status!=='source_presentation_only'||result.model_calls!==0) throw Error('Unconfirmed admission response; inspect source before retrying');
    const params=new URLSearchParams({select:'id,source_snapshot_id,source_identifier,vehicle_id,subject_type,subject_id,is_superseded,analysis_deferred,structured_data',id:`eq.${result.observation_id}`});
    const read=await send(new URL('/rest/v1/vehicle_observations?'+params,origin),{headers,signal:AbortSignal.timeout(10000)});
    if(!read.ok)throw Error('Admission returned an ID but source receipt readback failed');
    const rows=await read.json(),row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
    if(!row||row.id!==result.observation_id||row.source_snapshot_id!==id||row.source_identifier!==`retained_ecr_capture_v1:${id}`||row.vehicle_id!==null||row.subject_id!==null||row.subject_type!==(row.structured_data?.ecr_capture_receipt?.kind==='collection'?'organization':'vehicle')||row.is_superseded!==false||row.analysis_deferred!==true||row.structured_data?.ecr_capture_receipt?.snapshot_id!==id)
      throw Error('Persisted source receipt differs from admission response');
    const r={snapshot_id:id,status:result.duplicate?'existing':'admitted',observation_id:row.id,kind:row.structured_data.ecr_capture_receipt.kind,cards:row.structured_data.ecr_capture_receipt.cards.length,writes:result.writes};
    receipts.push(r);report(JSON.stringify(r));
  }
  return receipts;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const options=parseArgs(process.argv.slice(2));
  const result=await replay(options,{base:process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY});
  if(result.some(r=>r.status==='refused'))process.exitCode=2;
}
