import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeJson3,reviewWorkItems,runManifestDiscovery} from './broadcast-caption-discovery-loop.mjs';
import {discoverCaptionCues} from './broadcast-caption-discovery.mjs';

const fixture=async callback=>{
 const dir=await mkdtemp(join(tmpdir(),'caption-loop-test-')),cache=join(dir,'cache'),out=join(dir,'out');await mkdir(cache);
 const entry={video_id:'test0000001',source_url:'https://www.youtube.com/watch?v=test0000001',platform:'test_fixture',title:'Fixture',listed_duration_seconds:30,status:'queued'};
 const manifest=join(dir,'manifest.json');await writeFile(manifest,JSON.stringify({selection:[entry]}));
 const cacheFile=join(cache,'test0000001-INTERNAL.en.json3');
 await writeFile(cacheFile,JSON.stringify({events:[{tStartMs:1000,segs:[{utf8:'Original Corvette engine.'}]},{tStartMs:5000,segs:[{utf8:'Yes.'}]}]}));
 const options={manifest,cache_dir:cache,output_dir:out,max_sources:2,max_hours:1,max_new_rows:20,max_runtime_seconds:10};
 try{await callback({dir,cache,out,manifest,entry,cacheFile,options});}finally{await rm(dir,{recursive:true,force:true});}
};

test('JSON3 control/newline events are excluded without renumbering source cues',()=>{
 const s=normalizeJson3({events:[{tStartMs:0,id:1},{tStartMs:2000,segs:[{utf8:'Corvette.'}]},{tStartMs:1000,segs:[{utf8:'\n'}]},
 {tStartMs:2000,dDurationMs:5000,segs:[{utf8:'Ford.'}]}]}, {video_id:'test0000001'},'2026-10-02T00:00:00Z');
 assert.deepEqual(s.segments.map(c=>c.index),[1,3]);assert.equal(s.segments[1].delivery_duration_is_utterance_end,false);
});

test('process restart reuses completed source/hash/version receipts and frozen clock',async()=>fixture(async({out,options})=>{
 const first=await runManifestDiscovery(options);assert.equal(first.new_completed_sources,1);assert.equal(first.production_rows_written,0);
 const cp=JSON.parse(await readFile(join(out,'checkpoints','test0000001.json'),'utf8'));const bytes=await readFile(cp.grains);
 const second=await runManifestDiscovery(options);assert.equal(second.new_completed_sources,0);assert.equal(second.resumed_completed_sources,1);
 assert.deepEqual(await readFile(cp.grains),bytes);assert.equal(second.durable_totals.candidate_rows,first.durable_totals.candidate_rows);
}));

test('changed source bytes create a new run while preserving the previous source artifact',async()=>fixture(async({out,cacheFile,options})=>{
 await runManifestDiscovery(options);const p=join(out,'checkpoints','test0000001.json'),before=JSON.parse(await readFile(p,'utf8'));
 await writeFile(cacheFile,JSON.stringify({events:[{tStartMs:1000,segs:[{utf8:'Ford.'}]}]}));
 await runManifestDiscovery(options);const after=JSON.parse(await readFile(p,'utf8'));assert.notEqual(after.grains,before.grains);
 assert.ok((await readFile(before.grains)).length>0);assert.equal(JSON.parse(await readFile(after.report,'utf8')).baseline_comparison.baseline_candidate_rows,before.candidate_rows);
}));

test('candidate budget holds a whole source and resumes with a larger budget, without partial grains',async()=>fixture(async({out,options})=>{
 const first=await runManifestDiscovery({...options,max_new_rows:1});assert.equal(first.new_candidate_rows,0);
 const p=join(out,'checkpoints','test0000001.json');assert.equal(JSON.parse(await readFile(p,'utf8')).status,'candidate_rows_budget_hold');
 const second=await runManifestDiscovery(options);assert.equal(second.new_completed_sources,1);assert.equal(second.new_candidate_rows,2);
}));

test('invalid caption input produces persisted retry receipts and finite exhaustion',async()=>fixture(async({out,cacheFile,options})=>{
 await writeFile(cacheFile,'invalid JSON');await runManifestDiscovery({...options,max_attempts:2});
 const p=join(out,'checkpoints','test0000001.json');let cp=JSON.parse(await readFile(p,'utf8'));assert.equal(cp.attempts.length,1);assert.equal(cp.status,'retry_pending');
 cp.retry_at=null;await writeFile(p,JSON.stringify(cp));await runManifestDiscovery({...options,max_attempts:2});
 cp=JSON.parse(await readFile(p,'utf8'));assert.equal(cp.attempts.length,2);assert.equal(cp.status,'retry_exhausted');
}));

test('review tasks sample unhit cues without exporting their caption text',()=>{
 const source=normalizeJson3({events:[{tStartMs:0,segs:[{utf8:'Corvette.'}]},{tStartMs:1000,segs:[{utf8:'qwertyuiop.'}]}]},
 {video_id:'test0000001'},'2026-10-02T00:00:00Z');const result=discoverCaptionCues(source,{raw_source_ref:'/test/INTERNAL.json3'});
 const items=reviewWorkItems(source,result,'/test/INTERNAL.json3');assert.ok(items.some(i=>i.selection_reasons.includes('unhit_avenue_review')));
 assert.equal(JSON.stringify(items).includes('qwertyuiop'),false);assert.ok(items.every(i=>i.vehicle_id===null));
});

test('source limit includes failed sources and cannot spend the budget on a second source',async()=>fixture(async({out,cache,cacheFile,manifest,entry,options})=>{
 await writeFile(cacheFile,'invalid JSON');const other={...entry,video_id:'test0000002',source_url:'https://www.youtube.com/watch?v=test0000002'};
 await writeFile(manifest,JSON.stringify({selection:[entry,other]}));
 await writeFile(join(cache,'test0000002-INTERNAL.en.json3'),JSON.stringify({events:[{tStartMs:0,segs:[{utf8:'Ford.'}]}]}));
 const run=await runManifestDiscovery({...options,max_sources:1});assert.equal(run.new_completed_sources,0);assert.equal(run.distinct_new_sources_attempted,1);
 assert.equal(JSON.parse(await readFile(join(out,'checkpoints','test0000002.json'),'utf8')).status,'source_count_budget_hold');
}));

test('a dead-process lease can resume while a live-process lease refuses a second writer',async()=>fixture(async({out,options})=>{
 await mkdir(out,{recursive:true});const path=join(out,'loop.lock.json');await writeFile(path,JSON.stringify({pid:999999}));
 const run=await runManifestDiscovery(options);assert.equal(run.new_completed_sources,1);
 await writeFile(path,JSON.stringify({pid:process.pid}));await assert.rejects(()=>runManifestDiscovery(options),/already active/);
}));
