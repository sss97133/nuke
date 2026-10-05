import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateManifest, validateSources, validateProgress, validateCache, hash, VERSION, ownerModule, sourceSpans, bindSelections, selectorPrompt, verifySelectedOffsets, run } from './refinery-extract-claims.mjs';
const vid='713dfda0-38f2-4377-ad21-43a1d0b35c9d', eid='f1f0e1d1-6f72-4882-8606-88d5801948aa', id='06b341fc-476e-48cc-8c91-dc65d1a09515';
const manifest={vehicle_id:vid,event_id:eid,model:'qwen2.5vl:7b',comment_ids:[id]};
const comment={id,vehicle_id:vid,auction_event_id:eid,platform:'bat',bid_amount:null,comment_text:'Was the recall completed?',posted_at:'2026-10-01T00:00:00Z',created_at:'2026-10-02T00:00:00Z',source_url:'https://bringatrailer.com/listing/test/#comment-1'};
const expected={version:VERSION,source_hash:'source',parser_hash:'parser',landing_hash:'landing',prompt_hash:'prompt',adapter_hash:'adapter',span_map_hash:hash([]),model:manifest.model,model_digest:'digest'};
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
 const cache={...expected,provider:'local_ollama',span_map:[],cost_cents:0,content:'[]',output_hash:hash('[]'),completed_at:'2026-10-05T00:00:00Z',raw_response:{model:manifest.model,message:{content:'[]'},done:true,eval_count:2}};
 validateCache(cache,expected);
 for(const bad of [{...cache,source_hash:'changed'},{...cache,content:'altered'},{...cache,cost_cents:1},{...cache,raw_response:{...cache.raw_response,done_reason:'length'}},{...cache,raw_response:{...cache.raw_response,eval_count:3073}}]) assert.throws(()=>validateCache(bad,expected));
});
test('real strict parser distinguishes omitted, explicit empty and fabricated quote',()=>{
 const parser=ownerModule('supabase/functions/_shared/commentRefinery.ts').exports;
 assert.equal(parser.parseClaimResponse('[]',[comment]).processedCommentIds.length,0);
 assert.equal(parser.parseClaimResponse('[{"comment_index":1,"claims":[]}]',[comment]).processedCommentIds.length,1);
 assert.equal(parser.parseClaimResponse('[{"comment_index":1,"claims":[{"category":"Q","quote":"invented"}]}]',[comment]).processedCommentIds.length,0);
});
test('selector binds untouched UTF16 source spans; parser derives canonical categories/kinds',()=>{
 const c={...comment,comment_text:'Paint is grey. Is the roof original ?'};
 const spans=sourceSpans([c]);
 assert.equal(spans[1].text,'Is the roof original ?');
 const raw=JSON.stringify([{comment_index:1,claims:[{span_id:'c1s1',claim_type:'paint_identity',proposed_value:'grey',confidence:.5,epistemic_status:'asserted',action_status:'not_applicable',subject_scope:'vehicle',temporal_anchor:'current'}]}]);
 const bound=bindSelections(raw,[c],spans);
 assert.equal(JSON.parse(bound.input)[0].claims[0].quote,'Paint is grey. ');
 assert.equal(Object.hasOwn(JSON.parse(bound.input)[0].claims[0],'category'),false);
 const parsed=ownerModule('supabase/functions/_shared/commentRefinery.ts').exports.parseClaimResponse(bound.input,[c]);
 assert.equal(parsed.claims[0].category,'A');assert.equal(parsed.claims[0].source_quote_actual,'Paint is grey.');
 assert.equal(parsed.claims[0].subject_scope,'vehicle');
 assert.match(selectorPrompt({},[c],spans),/DO NOT output them/);
});
test('unknown/cross-comment/rewritten span selection rejects whole comment including duplicate sibling',()=>{
 const second={...comment,id:eid,comment_text:'A second source.'};
 const spans=sourceSpans([comment,second]);
 for(const atom of [{span_id:'unknown'},{span_id:'c2s1'},{span_id:'c1s1',quote:'rewritten'}]) {
  const raw=JSON.stringify([{comment_index:1,claims:[]},{comment_index:1,claims:[atom]}]);
  const bound=bindSelections(raw,[comment,second],spans);
  assert.deepEqual(JSON.parse(bound.input),[]);
  assert.ok(bound.bindingErrors[id]);
 }
 assert.deepEqual(bindSelections('{}',[comment],spans).bindingErrors,{batch:['invalid_selector_shape']});
});
test('bound selectors preserve semantic contradictions; never convert model scopes or plans to vehicle facts',()=>{
 const parser=ownerModule('supabase/functions/_shared/commentRefinery.ts').exports;
 for (const atom of [
  {claim_type:'general_spec',subject_scope:'vehicle'},
  {claim_type:'buyer_question',subject_scope:'model'},
  {claim_type:'seller_response',subject_scope:'comment'},
  {claim_type:'paint_identity',category:'B'},
  {claim_type:'paint_identity',observation_kind:'sighting'}
 ]) {
  const raw=JSON.stringify([{comment_index:1,claims:[{span_id:'c1s1',proposed_value:'test',confidence:.5,epistemic_status:atom.claim_type==='buyer_question'?'unknown':'asserted',action_status:'not_applicable',...atom}]}]);
  const bound=bindSelections(raw,[comment],sourceSpans([comment]));
  assert.equal(parser.parseClaimResponse(bound.input,[comment]).claims.length,0);
 }
 const c={...comment,is_seller:true,comment_text:'We will repair the car.'};
 const raw=JSON.stringify([{comment_index:1,claims:[{span_id:'c1s1',claim_type:'work_performed',proposed_value:'repair completed',confidence:.5,epistemic_status:'asserted',action_status:'completed'}]}]);
 const bound=bindSelections(raw,[c],sourceSpans([c]));
 assert.equal(parser.parseClaimResponse(bound.input,[c]).processedCommentIds.length,0);
});
test('unqualified extractor write refuses before configuration, source reads or admission',async()=>{
 const original=globalThis.fetch;
 let requests=0;globalThis.fetch=()=>{requests++;throw Error('network must not run');};
 try { await assert.rejects(run(['--write']),/extractor_not_qualified/);assert.equal(requests,0); }
 finally {globalThis.fetch=original;}
});
test('selected repeated quote cannot silently acquire first-occurrence offsets',()=>{
 const c={...comment,comment_text:'Paint is grey. Paint is grey.'};const spans=sourceSpans([c]);
 const raw=JSON.stringify([{comment_index:1,claims:[{span_id:'c1s2',claim_type:'paint_identity',proposed_value:'grey',confidence:.5,epistemic_status:'asserted',action_status:'not_applicable',subject_scope:'vehicle'}]}]);
 const bound=bindSelections(raw,[c],spans),parser=ownerModule('supabase/functions/_shared/commentRefinery.ts').exports;
 const parsed=verifySelectedOffsets(parser.parseClaimResponse(bound.input,[c]),bound,[c],spans);
 assert.equal(parsed.claims.length,0);assert.equal(parsed.processedCommentIds.length,0);assert.deepEqual(parsed.commentErrors[id],['selected_span_offset_mismatch']);
 const first=bindSelections(raw.replace('c1s2','c1s1'),[c],spans);
 assert.equal(verifySelectedOffsets(parser.parseClaimResponse(first.input,[c]),first,[c],spans).claims.length,1);
});
