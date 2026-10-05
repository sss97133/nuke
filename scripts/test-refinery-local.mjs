import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateManifest, validateSources, validateProgress, validateCache, hash, VERSION, ownerModule } from './refinery-extract-claims.mjs';
const vid='713dfda0-38f2-4377-ad21-43a1d0b35c9d', eid='f1f0e1d1-6f72-4882-8606-88d5801948aa', id='06b341fc-476e-48cc-8c91-dc65d1a09515';
const manifest={vehicle_id:vid,event_id:eid,model:'qwen2.5vl:7b',comment_ids:[id]};
const comment={id,vehicle_id:vid,auction_event_id:eid,platform:'bat',bid_amount:null,comment_text:'Was the recall completed?',posted_at:'2026-10-01T00:00:00Z',created_at:'2026-10-02T00:00:00Z',source_url:'https://bringatrailer.com/listing/test/#comment-1'};
const expected={version:VERSION,source_hash:'source',parser_hash:'parser',landing_hash:'landing',prompt_hash:'prompt',model:manifest.model,model_digest:'digest'};
const progress={comment_id:id,vehicle_id:vid,extraction_result:null,llm_processed:false,extraction_version:null};
test('exact bounded local manifest excludes cloud, pilot and duplicate source IDs',()=>{
 assert.equal(validateManifest(manifest),manifest);
 for(const m of [{...manifest,model:'glm-4.6:cloud'},{...manifest,comment_ids:[id,id]},{...manifest,vehicle_id:'2e61fa34-c5b4-4709-9636-4823546a5bc4'},{...manifest,comment_ids:[id,id,id]}]) assert.throws(()=>validateManifest(m));
});
test('actual auction event source/vehicle/public/clock/URL/bid eligibility',()=>{
 const v={id:vid,is_public:true,deleted_at:null}, e={id:eid,vehicle_id:vid,source:'bat',source_url:'https://bringatrailer.com/listing/test/'};
 validateSources(manifest,v,e,[comment]);
 for(const c of [{...comment,auction_event_id:vid},{...comment,posted_at:null},{...comment,created_at:null},{...comment,bid_amount:1},{...comment,platform:'other'},{...comment,source_url:'https://bringatrailer.com/listing/other/'}]) assert.throws(()=>validateSources(manifest,v,e,[c]));
 assert.throws(()=>validateSources(manifest,{...v,is_public:false},e,[comment]));
 assert.throws(()=>validateSources(manifest,{...v,listing_kind:'non_vehicle_item'},e,[comment]));
 assert.throws(()=>validateSources(manifest,v,{...e,source:'other'},[comment]));
});
test('missing, differently-owned and completed progress defer; exact own ID replay allowed',()=>{
 validateProgress(manifest,[progress],expected,null);
 for(const rows of [[],[{...progress,extraction_result:{}}],[{...progress,extraction_version:'public_comment_atoms_v1'}],[{...progress,llm_processed:true,observation_ids:[eid]}]]) assert.throws(()=>validateProgress(manifest,rows,expected,null));
 const complete={...progress,llm_processed:true,extraction_version:VERSION,llm_model:manifest.model,observation_ids:[eid]};
 const prior={...expected,landed:{failed_comments:1,processed_comment_ids:[id],derived:[{comment_id:id,observation_id:eid,credential:'local_ollama'}]}};
 validateProgress(manifest,[complete],expected,prior);
 assert.throws(()=>validateProgress(manifest,[{...complete,observation_ids:[vid]}],expected,prior));
 assert.throws(()=>validateProgress(manifest,[complete],expected,{...prior,source_hash:'changed'}));
});
test('cache pins source/parser/model/output; truncated responses never accepted',()=>{
 const cache={...expected,provider:'local_ollama',cost_cents:0,content:'[]',output_hash:hash('[]'),completed_at:'2026-10-05T00:00:00Z',raw_response:{model:manifest.model,message:{content:'[]'},done:true,eval_count:2}};
 validateCache(cache,expected);
 for(const bad of [{...cache,source_hash:'changed'},{...cache,content:'altered'},{...cache,cost_cents:1},{...cache,raw_response:{...cache.raw_response,done_reason:'length'}},{...cache,raw_response:{...cache.raw_response,eval_count:3073}}]) assert.throws(()=>validateCache(bad,expected));
});
test('real strict parser distinguishes omitted, explicit empty and fabricated quote',()=>{
 const parser=ownerModule('supabase/functions/_shared/commentRefinery.ts').exports;
 assert.equal(parser.parseClaimResponse('[]',[comment]).processedCommentIds.length,0);
 assert.equal(parser.parseClaimResponse('[{"comment_index":1,"claims":[]}]',[comment]).processedCommentIds.length,1);
 assert.equal(parser.parseClaimResponse('[{"comment_index":1,"claims":[{"category":"Q","quote":"invented"}]}]',[comment]).processedCommentIds.length,0);
});
