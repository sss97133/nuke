#!/usr/bin/env node
/** Receipt-driven public catalog capture. No DB writes, inference or checkout.
 * --input PRIVATE_LEDGER --output PRIVATE_DIR [--capture] [--limit N] [--sources JSON]
 * sources: [{vendor,part_number,page_url,source_role}]. Successful captures are reused.
 * Catalog references never establish installation, payment or receipt expense.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {normalizePart, lineRole as role, productEligible, parseProductPage as parseProduct} from '../supabase/functions/_shared/receiptProductCapture.mjs';
export {normalizePart, parseProduct};
import sharp from 'sharp';
const sha = x => createHash('sha256').update(x).digest('hex');
const now = () => new Date().toISOString();
export function receiptQueries(ledger, sources = []) {
  if (!Array.isArray(ledger.receipts)) throw Error('input must contain receipts[]');
  const qs = new Map(), exclusions = [];
  for (const r of ledger.receipts) for (const l of r.lines ?? []) {
    const pn = normalizePart(l.part_number), kind = role(l);
    if (!productEligible(l)) {
      exclusions.push({receipt_id:r.id,line_id:l.id,reason:!pn?'no_part_number':kind}); continue;
    }
    const key = `${r.vendor_name}\n${pn}`;
    if (!qs.has(key)) {
      const candidates = sources.filter(s => s.vendor === r.vendor_name && normalizePart(s.part_number) === pn).map(s => ({page_url:s.page_url,source_role:s.source_role ?? 'same_sku_alternate_supplier'}));
      if (r.vendor_name === 'Classic Industries' && !candidates.length) candidates.push({page_url:`https://www.oerparts.com/product/${encodeURIComponent(pn.toLowerCase())}.html`,source_role:'same_sku_catalog_cross_reference'});
      qs.set(key,{key:sha(key).slice(0,20),vendor:r.vendor_name,part_number:pn,query:`${r.vendor_name} ${pn} ${l.description}`,candidates,receipt_lines:[]});
    }
    qs.get(key).receipt_lines.push({receipt_id:r.id,line_id:l.id,source_document_id:r.source_document_id,source_file:r.file_name,receipt_date:r.receipt_date,printed_part_number:l.part_number,description:l.description,quantity:l.quantity,unit_price:l.unit_price,total_price:l.total_price,role:kind});
  }
  return {ledger_read_at:ledger.read_at,source_documents:ledger.receipts.length,source_lines:ledger.receipts.reduce((n,r)=>n+(r.lines?.length??0),0),queries:[...qs.values()],exclusions};
}
async function capture(url,maxBytes) {
  const u=new URL(url);
  if(u.protocol!=='https:'||!/^[a-z0-9.-]+$/i.test(u.hostname)||/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname))throw Error('public HTTPS source required');
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(25000),redirect:'error'});
  if(!r.ok){const error=Error(`HTTP ${r.status}`);error.status=r.status;error.retryAfter=r.headers.get('retry-after');throw error;}
  const chunks=[];let size=0;
  for await(const b of r.body){size+=b.length;if(size>maxBytes)throw Error('capture exceeds size limit');chunks.push(b);}
  const bytes=Buffer.concat(chunks);return {bytes,url:r.url,captured_at:now(),content_type:r.headers.get('content-type'),sha256:sha(bytes)};
}
export async function main(argv) {
  const arg=n=>{const i=argv.indexOf(n);return i<0?null:argv[i+1]};
  const input=arg('--input'),out=arg('--output');
  if(!input||!out)throw Error('required: --input PRIVATE_LEDGER --output PRIVATE_DIR [--capture] [--limit N] [--sources JSON]');
  const bytes=await fs.readFile(input), sources=arg('--sources')?JSON.parse(await fs.readFile(arg('--sources'),'utf8')):[];
  const manifest=receiptQueries(JSON.parse(bytes),sources);manifest.source_ledger_sha256=sha(bytes);manifest.prepared_at=now();
  await fs.mkdir(out,{recursive:true,mode:0o700});await fs.writeFile(path.join(out,'query-manifest.json'),JSON.stringify(manifest,null,2));
  if(!argv.includes('--capture')){console.log(JSON.stringify({queries:manifest.queries.length,exclusions:manifest.exclusions.length}));return;}
  let processed=0;const blockedHosts=new Set();
  for(const q of manifest.queries.filter(q=>q.candidates.length).slice(0,Number(arg('--limit')??Infinity))) {
    const dir=path.join(out,q.key);await fs.mkdir(dir,{recursive:true});const dest=path.join(dir,'result.json');
    let prev;try{prev=JSON.parse(await fs.readFile(dest,'utf8'))}catch{}
    if(prev?.status==='captured'&&!argv.includes('--refresh'))continue;
    const result={query:q,status:'unresolved',attempts:[],prior_runs:prev?[...(prev.prior_runs??[]),{status:prev.status,attempts:prev.attempts}]:[]};
    for(const c of q.candidates){
      const a={...c,attempted_at:now()};result.attempts.push(a);
      if(blockedHosts.has(new URL(c.page_url).hostname)){a.error='host_rate_limited_earlier_in_run';result.status='rate_limited';continue;}
      try{
        const page=await capture(c.page_url,4000000);await fs.writeFile(path.join(dir,'page.html'),page.bytes);
        a.page={...page,bytes:page.bytes.length,path:path.join(dir,'page.html')};a.product=parseProduct(page.bytes.toString('utf8'),page.url,q.part_number);
        if(a.product.status!=='exact_sku_page')continue;
        const pic=await capture(a.product.image_url,15000000);
        if(!pic.content_type?.startsWith('image/'))throw Error('image URL did not return image MIME');
        const m=await sharp(pic.bytes).metadata();if(m.width<50||m.height<50)throw Error('image too small');
        const imagePath=path.join(dir,`stock.${m.format}`);await fs.writeFile(imagePath,pic.bytes);
        a.image={...pic,bytes:pic.bytes.length,path:imagePath,width:m.width,height:m.height};result.status='captured';result.source_role='catalog_reference_not_vehicle_photo';break;
      }catch(e){a.error=String(e.message);if(e.status===429){a.retry_after=e.retryAfter;blockedHosts.add(new URL(c.page_url).hostname);result.status='rate_limited';}}
      await new Promise(r=>setTimeout(r,400));
    }
    await fs.writeFile(dest,JSON.stringify(result,null,2));processed++;if(processed%10===0)console.log(JSON.stringify({processed}));
    if(result.status!=='rate_limited')await new Promise(r=>setTimeout(r,Number(arg('--delay-ms')??5000)));
  }
  const results=[];for(const q of manifest.queries){try{results.push(JSON.parse(await fs.readFile(path.join(out,q.key,'result.json'),'utf8')))}catch{results.push({query:q,status:q.candidates.length?'not_attempted':'needs_source_resolution'})}}
  const summary={as_of:now(),source_documents:manifest.source_documents,source_lines:manifest.source_lines,unique_queries:results.length,captured:results.filter(r=>r.status==='captured').length,statuses:results.reduce((a,r)=>({...a,[r.status]:(a[r.status]??0)+1}),{}),excluded_lines:manifest.exclusions.length,database_admission:'not_performed',results};
  await fs.writeFile(path.join(out,'capture-index.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,results:undefined}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
