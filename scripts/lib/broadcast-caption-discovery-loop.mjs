/** Durable cache-first discovery under the existing Mecum analyzer owner. No DB writes. */
import { readFile, writeFile, rename, mkdir, readdir, stat, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { discoverCaptionCues, DISCOVERY_VERSION } from './broadcast-caption-discovery.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const existsJson = async path => { try { return JSON.parse(await readFile(path,'utf8')); } catch(e) { if(e.code==='ENOENT') return null; throw e; } };
const atomic = async (path,value) => { await mkdir(resolve(path,'..'),{recursive:true}); const tmp=`${path}.${process.pid}.tmp`;
  await writeFile(tmp,JSON.stringify(value,null,2)+'\n'); await rename(tmp,path); };

export function normalizeJson3(raw,entry,capturedAt) {
  if(!Array.isArray(raw.events)) throw new Error('JSON3 events required');
  const segments=raw.events.flatMap((e,index)=>{
    const text=(e.segs??[]).map(s=>s.utf8??'').join('').trim();
    if(!text) return [];
    if(!Number.isFinite(e.tStartMs)||e.tStartMs<0) throw new Error('Nonnegative JSON3 caption onset required');
    return [{index,time_seconds:e.tStartMs/1000,text,source_event_index:index,
      source_window_id:e.wWinId??null,append_to_window:e.aAppend===1,
      delivery_duration_ms:e.dDurationMs??null,delivery_duration_is_utterance_end:false}];
  }).sort((a,b)=>a.time_seconds-b.time_seconds||a.index-b.index);
  if(!segments.length) throw new Error('No nonempty captions in source cache');
  return {video_id:entry.video_id,captured_at:capturedAt,transcript_type:'youtube_cached_json3',
    timing_unit:'seconds_from_media_start',capture_time_basis:'cached_evidence_read_time',
    normalization_version:'json3-event-grains-v1',source_event_count:raw.events.length,segments};
}

export function reviewWorkItems(source,result,rawRef) {
  const byCue=new Map();
  for(const g of result.grains) { const index=g.structured_data.media.caption_index;
    if(!byCue.has(index)) byCue.set(index,[]); byCue.get(index).push(g); }
  const selected=new Map();
  const add=(cue,reason)=>{if(!selected.has(cue.index)) selected.set(cue.index,new Set()); selected.get(cue.index).add(reason);};
  const cues=new Map(source.segments.map(c=>[c.index,c]));
  for(const category of result.summary.categories) {
    const rows=result.grains.filter(g=>g.structured_data.property===category.property);
    for(const i of [...new Set([0,Math.floor(rows.length/2),rows.length-1])]) if(rows[i]) add(cues.get(rows[i].structured_data.media.caption_index),`stratified:${category.property}`);
  }
  const unhit=source.segments.filter(c=>!byCue.has(c.index));
  for(let i=0;i<Math.min(8,unhit.length);i++) add(unhit[Math.floor(i*(unhit.length-1)/Math.max(1,Math.min(8,unhit.length)-1))],'unhit_avenue_review');
  const flagged=source.segments.filter(c=>/\b(?:19[2-9]\d|20[0-2]\d|collector\s+car|one\s+of|special\s+edition|excitement)\b/i.test(c.text) ||
    (byCue.get(c.index)??[]).some(g=>g.structured_data.value.explicit_currency_parses?.some(p=>p.amount>=1e8)));
  for(let i=0;i<Math.min(8,flagged.length);i++) add(flagged[Math.floor(i*(flagged.length-1)/Math.max(1,Math.min(8,flagged.length)-1))],'flagged_scope_or_numeric_review');
  return [...selected].map(([index,reasons])=>{const c=cues.get(index);return {
    work_item_id:`youtube:${source.video_id}:caption:${index}:scope-review:v1`,video_id:source.video_id,
    caption_index:index,start_seconds:c.time_seconds,source_caption_sha256:sha(c.text),raw_source_ref:`${rawRef}#caption-index=${index}`,
    source_url:`https://www.youtube.com/watch?v=${source.video_id}&t=${Math.floor(c.time_seconds)}s`,
    selection_reasons:[...reasons],candidate_properties:(byCue.get(index)??[]).map(g=>g.structured_data.property),
    status:'pending_source_scope_review',speaker_role:null,vehicle_id:null,
    review_prompt:'Read source context; distinguish vehicle fact claims, opinion, event/platform context, historical numbers and missing avenues. Verify audio/video separately.'};});
}

function limits(options) {
  const out={max_sources:Number(options.max_sources??6),max_hours:Number(options.max_hours??24),max_new_rows:Number(options.max_new_rows??50000),
    max_attempts:Number(options.max_attempts??3),max_runtime_seconds:Number(options.max_runtime_seconds??3600),poll_seconds:Number(options.poll_seconds??30)};
  for(const [key,value] of Object.entries(out)) if(!Number.isFinite(value)||value<=0) throw new Error(`Positive ${key} required`);
  if(!Number.isInteger(out.max_sources)||!Number.isInteger(out.max_new_rows)||!Number.isInteger(out.max_attempts)) throw new Error('Integer source/row/attempt limits required');
  out.poll_seconds=Math.min(out.poll_seconds,60);return out;
}

async function acquire(entry,cacheDir,options) {
  if(!options.yt_dlp_bin) throw new Error('Explicit existing yt-dlp executable required for anonymous acquisition');
  if(!/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(entry.source_url??'')) throw new Error('Known public YouTube source URL required');
  const argv=['--ignore-config','--no-update','--skip-download','--write-subs','--write-auto-subs','--sub-langs','en,en-US,en-GB,en-orig','--sub-format','json3',
    '--no-playlist','--no-progress','--retries','1','--extractor-retries','1','--socket-timeout','10','-o',join(cacheDir,`${entry.video_id}-INTERNAL.%(ext)s`),entry.source_url];
  const started=Date.now();let output='';
  const result=await new Promise((resolvePromise,reject)=>{const child=spawn(options.yt_dlp_bin,argv,{stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
    child.stdout.on('data',b=>{output=(output+b.toString()).slice(-4000);});child.stderr.on('data',b=>{output=(output+b.toString()).slice(-4000);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolvePromise({code});});});
  return {method:'anonymous_existing_yt_dlp_caption_only',source_url:entry.source_url,video_id:entry.video_id,
    captured_at:now(),elapsed_seconds:(Date.now()-started)/1000,exit_code:result.code,
    cookies_used:false,credentials_used:false,paid_model_api_calls:0,log_tail:output.replace(/https?:\/\/\S+/g,'[transport URL removed]')};
}

/** Resumes completed source/hash/version receipts; one atomic source receipt is the unit of progress. */
export async function runManifestDiscovery(options) {
  const bounds=limits(options),outputDir=resolve(options.output_dir),cacheDir=resolve(options.cache_dir),start=Date.now();
  await mkdir(outputDir,{recursive:true});await mkdir(cacheDir,{recursive:true});
  const manifest=await existsJson(resolve(options.manifest));
  if(!Array.isArray(manifest?.selection)||!manifest.selection.length) throw new Error('Manifest selection required');
  const seen=new Set();for(const e of manifest.selection){if(!/^[A-Za-z0-9_-]{11}$/.test(e.video_id)||seen.has(e.video_id)) throw new Error('Manifest must have unique valid video IDs');seen.add(e.video_id);}
  const lockPath=join(outputDir,'loop.lock.json');const oldLock=await existsJson(lockPath);
  if(oldLock?.pid){let live=true;try{process.kill(oldLock.pid,0);}catch(e){if(e.code==='ESRCH')live=false;else throw e;}
    if(live)throw new Error(`Discovery loop already active with PID ${oldLock.pid}`);await unlink(lockPath);}
  const lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,started_at:now()}));await lock.close();
  let stopping=false;const stop=()=>{stopping=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const run={run_id:`caption-loop:${process.pid}:${Date.now()}`,pid:process.pid,started_at:now(),manifest:resolve(options.manifest),manifest_source_count:manifest.selection.length,
    limits:bounds,mode:options.watch?'bounded_watch':'bounded_batch',acquisition_enabled:!!options.acquire_captions,
    code_discovery_version:DISCOVERY_VERSION,new_completed_sources:0,new_candidate_rows:0,new_source_seconds:0,
    source_attempts:0,errors:0,resumed_completed_sources:0,paid_model_api_calls:0,production_rows_written:0,
    writer_enabled:false,candidate_truth_promotion_enabled:false,review_work_items:0,status:'running',sources:[],
    improvement_evidence:'Human scope assay -> tested next-car grammar revision -> version1/version2 comparison. No autonomous code changes or releases.'};
  const checkpoints=new Map();const cpPath=id=>join(outputDir,'checkpoints',`${id}.json`);
  const resumed=new Set(),activeSources=new Set();
  const activate=id=>{if(!activeSources.has(id)&&activeSources.size>=bounds.max_sources)return false;
    activeSources.add(id);run.distinct_new_sources_attempted=activeSources.size;return true;};
  for(const e of manifest.selection) checkpoints.set(e.video_id,await existsJson(cpPath(e.video_id))??{video_id:e.video_id,status:'queued',attempts:[]});
  const publish=async()=>{run.updated_at=now();run.elapsed_seconds=(Date.now()-start)/1000;
    run.sources=manifest.selection.map(e=>{const c=checkpoints.get(e.video_id);return {video_id:e.video_id,platform:e.platform,status:c.status,
      candidate_rows:c.candidate_rows??0,review_items:c.review_items??0,attempt_count:c.attempts.length,retry_at:c.retry_at??null,report:c.report??null,error:c.error??null};});
    run.durable_totals={completed_sources:run.sources.filter(s=>s.status==='completed').length,
      candidate_rows:run.sources.filter(s=>s.status==='completed').reduce((n,s)=>n+s.candidate_rows,0),
      review_items:run.sources.filter(s=>s.status==='completed').reduce((n,s)=>n+s.review_items,0)};
    await atomic(join(outputDir,'loop-status.json'),run);};
  await publish();
  try {
    do {
      let progressed=false;
      for(const entry of manifest.selection) {
        if(stopping||Date.now()-start>=bounds.max_runtime_seconds*1000)break;
        if(run.new_completed_sources>=bounds.max_sources)break;
        let cp=checkpoints.get(entry.video_id);
        if(cp.budget_hold_run_id===run.run_id)continue;
        if(entry.status==='confirmed_upcoming'){cp.status='upcoming_not_mined';await atomic(cpPath(entry.video_id),cp);continue;}
        const files=(await readdir(cacheDir)).filter(f=>f.startsWith(`${entry.video_id}-INTERNAL.`)&&f.endsWith('.json3')).sort((a,b)=>Number(b.includes('en-orig'))-Number(a.includes('en-orig'))||a.localeCompare(b));
        let rawPath=files[0]?join(cacheDir,files[0]):entry.transcript_path?resolve(entry.transcript_path):null;
        if(!rawPath&&!options.acquire_captions){if(cp.status!=='waiting_for_cache'){cp.status='waiting_for_cache';await atomic(cpPath(entry.video_id),cp);}continue;}
        if(cp.status==='retry_exhausted' || (cp.retry_at&&Date.parse(cp.retry_at)>Date.now()))continue;
        let attempted=false;
        try {
          if(!rawPath){
            if(!activate(entry.video_id)){cp.status='source_count_budget_hold';cp.budget_hold_run_id=run.run_id;await atomic(cpPath(entry.video_id),cp);continue;}
            if(cp.attempts.length>=bounds.max_attempts){cp.status='retry_exhausted';await atomic(cpPath(entry.video_id),cp);continue;}
            cp.status='acquiring';cp.attempts.push({started_at:now(),status:'acquiring'});attempted=true;await atomic(cpPath(entry.video_id),cp);await publish();run.source_attempts++;
            const receipt=await acquire(entry,cacheDir,options);await atomic(join(outputDir,'acquisition',`${entry.video_id}-attempt${cp.attempts.length}.json`),receipt);
            if(receipt.exit_code!==0)throw new Error(`Anonymous caption acquisition exited ${receipt.exit_code}`);
            const downloaded=(await readdir(cacheDir)).filter(f=>f.startsWith(`${entry.video_id}-INTERNAL.`)&&f.endsWith('.json3')).sort();
            if(!downloaded.length)throw new Error('No captions returned for public source');rawPath=join(cacheDir,downloaded[0]);
          }
          const bytes=await readFile(rawPath),inputHash=sha(bytes),fingerprint=`${DISCOVERY_VERSION}-${inputHash.slice(0,16)}`;
          const sourceDir=join(outputDir,'sources',entry.video_id,'runs',fingerprint),normalizedPath=join(sourceDir,'normalized-INTERNAL.json');
          if(cp.status==='completed'&&cp.input_sha256===inputHash&&cp.discovery_version===DISCOVERY_VERSION) {
            const persisted=await readFile(cp.grains);if(sha(persisted)!==cp.grains_sha256)throw new Error('Completed artifact hash mismatch; source needs repair');
            resumed.add(entry.video_id);run.resumed_completed_sources=resumed.size;continue;
          }
          const duration=entry.listed_duration_seconds;
          if(!Number.isFinite(duration)||duration<=0){cp.status='duration_unknown_budget_hold';await atomic(cpPath(entry.video_id),cp);continue;}
          if(run.new_source_seconds+duration>bounds.max_hours*3600){cp.status='source_hours_budget_hold';cp.budget_hold_run_id=run.run_id;await atomic(cpPath(entry.video_id),cp);continue;}
          if(!activate(entry.video_id)){cp.status='source_count_budget_hold';cp.budget_hold_run_id=run.run_id;await atomic(cpPath(entry.video_id),cp);continue;}
          const existing=await existsJson(normalizedPath);
          const source=existing??(()=>{const raw=JSON.parse(bytes.toString('utf8'));return raw.segments?raw:normalizeJson3(raw,entry,now());})();
          if(source.video_id!==entry.video_id)throw new Error('Cache/manifest video identity mismatch');
          await atomic(normalizedPath,source);
          await atomic(join(sourceDir,'normalization-receipt.json'),{video_id:entry.video_id,raw_source_ref:rawPath,raw_source_sha256:inputHash,
            evidence_read_at:source.captured_at,evidence_read_time_basis:source.capture_time_basis??'input_frozen_capture_time',
            cache_file_mtime:(await stat(rawPath)).mtime.toISOString(),cache_mtime_is_event_time:false,normalized_internal_ref:normalizedPath});
          const before=cp.report?await existsJson(cp.report):null;
          cp.status='processing';cp.input_sha256=inputHash;cp.discovery_version=DISCOVERY_VERSION;
          if(cp.attempts.at(-1)?.status!=='acquiring'){cp.attempts.push({started_at:now(),status:'processing'});run.source_attempts++;}attempted=true;
          await atomic(cpPath(entry.video_id),cp);await publish();
          const scanOptions={raw_source_ref:rawPath,event_date:entry.event_date,auction_house:entry.platform,auction:entry.title,duration_seconds:duration,available_at:entry.published_at};
          const result=discoverCaptionCues(source,scanOptions),replay=discoverCaptionCues(source,scanOptions);
          const firstDigest=sha(JSON.stringify(result.grains)),secondDigest=sha(JSON.stringify(replay.grains));
          if(firstDigest!==secondDigest||result.summary.yield.unique_source_grains!==result.grains.length)throw new Error('Candidate replay/identity assay failed');
          if(run.new_candidate_rows+result.grains.length>bounds.max_new_rows){cp.status='candidate_rows_budget_hold';cp.pending_candidate_rows=result.grains.length;cp.budget_hold_run_id=run.run_id;
            cp.attempts.at(-1).status='budget_hold';await atomic(cpPath(entry.video_id),cp);continue;}
          const work=reviewWorkItems(source,result,rawPath),report={...result.summary,generated_at:now(),raw_source_sha256:inputHash,
            platform:entry.platform,title:entry.title,normalization_receipt:join(sourceDir,'normalization-receipt.json'),
            replay_assay:{equal:true,source_grains:result.grains.length,digest:firstDigest,rows_added_on_replay:0},
            review_work_items:work.length,baseline_comparison:before?{baseline_version:before.discovery_version,
              baseline_candidate_rows:before.yield.candidate_source_grains,revised_candidate_rows:result.grains.length,
              delta:result.grains.length-before.yield.candidate_source_grains,meaning:'Candidate yield difference; no precision/recall claim.'}:null,
            candidate_holds:['Unknown speaker/vehicle/lot identity','Language is a discovery lead, not vehicle truth or accepted money','Event date unknown unless supplied explicitly'],production_rows_written:0};
          const grainsPath=join(sourceDir,'candidate-grains.json');await atomic(grainsPath,{status:'review_only',observations:result.grains});
          await atomic(join(sourceDir,'review-work-items.json'),{items:work});await atomic(join(sourceDir,'review-windows.json'),{windows:result.review_windows});
          await atomic(join(sourceDir,'report.json'),report);
          cp={...cp,status:'completed',completed_at:now(),candidate_rows:result.grains.length,review_items:work.length,
            report:join(sourceDir,'report.json'),grains:grainsPath,grains_sha256:sha(await readFile(grainsPath)),retry_at:null,error:null};
          cp.attempts.at(-1).status='completed';cp.attempts.at(-1).finished_at=now();checkpoints.set(entry.video_id,cp);await atomic(cpPath(entry.video_id),cp);
          run.new_completed_sources++;run.new_candidate_rows+=result.grains.length;run.new_source_seconds+=duration;run.review_work_items+=work.length;progressed=true;await publish();
        }catch(e){activate(entry.video_id);run.errors++;cp.error=String(e.message).slice(0,1000);
          if(!attempted){cp.attempts.push({started_at:now(),status:'error'});run.source_attempts++;}
          cp.status=cp.attempts.length>=bounds.max_attempts?'retry_exhausted':'retry_pending';
          cp.attempts.at(-1).status='error';cp.attempts.at(-1).error=cp.error;cp.attempts.at(-1).finished_at=now();
          cp.retry_at=new Date(Date.now()+Math.min(300000,30000*2**Math.min(cp.attempts.length,4))).toISOString();
          checkpoints.set(entry.video_id,cp);await atomic(cpPath(entry.video_id),cp);await publish();}
      }
      await publish();
      const activeDone=activeSources.size>=bounds.max_sources&&[...activeSources].every(id=>
        ['completed','retry_exhausted','candidate_rows_budget_hold','source_hours_budget_hold','duration_unknown_budget_hold'].includes(checkpoints.get(id).status));
      if(!options.watch||stopping||activeDone||Date.now()-start>=bounds.max_runtime_seconds*1000)break;
      run.status=progressed?'running':'waiting_for_cache_or_retry';await publish();
      await new Promise(resolvePromise=>setTimeout(resolvePromise,bounds.poll_seconds*1000));run.status='running';
    }while(!stopping);
    run.status=stopping?'stopped':run.new_completed_sources>=bounds.max_sources?'source_limit_reached':Date.now()-start>=bounds.max_runtime_seconds*1000?'runtime_limit_reached':'batch_complete';
    run.finished_at=now();await publish();await atomic(join(outputDir,'runs',`${run.run_id.replaceAll(':','-')}.json`),run);return run;
  }finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);await unlink(lockPath);}
}
