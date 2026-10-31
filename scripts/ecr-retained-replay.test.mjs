import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseArgs,replay} from './ecr-retained-replay.mjs';
const id='11111111-1111-4111-8111-111111111111',obs='22222222-2222-4222-8222-222222222222';
const reply=(v,status=200)=>new Response(JSON.stringify(v),{status});
test('explicit bounded selection defaults to dry-run; rejects ambiguous selectors',()=>{
  assert.deepEqual(parseArgs(['--snapshot',id]),{ids:[id],apply:false});
  for(const args of [[],['--all'],['--snapshot','bad'],['--snapshot',id,'--snapshot',id],['--snapshot',id,'--unknown']])assert.throws(()=>parseArgs(args));
});
test('dry-run invokes only canonical selector; never writes from client values',async()=>{
  const calls=[];
  const rows=await replay({ids:[id],apply:false},{base:'https://fixture.supabase.co',key:'sb_secret_fixture',report:()=>{},send:async(url,init)=>{
    calls.push(url);assert.deepEqual(JSON.parse(init.body),{mode:'retained_ecr_capture_v1',snapshot_id:id,dry_run:true});
    assert(!init.headers.Authorization);
    return reply({success:true,dry_run:true,writes:0,model_calls:0,receipt:{snapshot_id:id,kind:'collection',cards:[]}});
  }});
  assert.equal(calls.length,1);assert.equal(rows[0].status,'qualified');
});
test('apply checks durable observation; transport success without source binding is refused',async()=>{
  for(const bad of [false,true]){
    let n=0;
    const run=()=>replay({ids:[id],apply:true},{base:'https://fixture.supabase.co',key:'key',report:()=>{},send:async()=>{
      if(++n===1)return reply({success:true,observation_id:obs,snapshot_id:id,resolution_status:'source_presentation_only',model_calls:0,writes:1});
      return reply([{id:obs,source_snapshot_id:bad?obs:id,source_identifier:`retained_ecr_capture_v1:${id}`,vehicle_id:null,subject_type:'organization',subject_id:null,is_superseded:false,analysis_deferred:true,structured_data:{ecr_capture_receipt:{snapshot_id:id,kind:'collection',cards:[]}}}]);
    }});
    if(bad)await assert.rejects(run,/differs/);else assert.equal((await run())[0].status,'admitted');
  }
});
