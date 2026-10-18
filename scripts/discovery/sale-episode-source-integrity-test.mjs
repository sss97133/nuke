#!/usr/bin/env node
// Installed PG17, fully synthetic disposable schema, actual migration and two sessions.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ci = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
if (ci) {
  assert.equal(process.env.CI, 'true', 'CI service mode requires CI=true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'CI service mode requires GITHUB_ACTIONS=true');
  assert.equal(process.env.PGHOST, 'localhost', 'CI service mode only accepts PGHOST=localhost');
  assert.equal(process.env.PGUSER, 'postgres', 'CI service mode requires the disposable postgres service user');
  assert.equal(process.env.PGPORT || '5432', '5432', 'CI service mode only accepts the existing service port');
}
const bin = process.env.PG17_BIN || (ci ? '' : '/opt/homebrew/opt/postgresql@17/bin');
const executable = name => bin ? join(bin,name) : name;
// Explicit task-owned connection arguments must not inherit a service/host override.
const childEnv = {...process.env};
for (const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGDATABASE','PGOPTIONS']) delete childEnv[key];
const run = (name,args) => execFileSync(executable(name),args,{cwd:root,env:childEnv,encoding:'utf8',maxBuffer:8*1024*1024});
if (!ci) assert.match(run('psql',['--version']),/PostgreSQL\) 17\./,'Installed PG17 required');
// macOS TMPDIR plus the socket filename can exceed AF_UNIX's path limit.
const base = mkdtempSync(join(process.platform==='darwin'?'/private/tmp':tmpdir(),'nuke-sale-episode-pg-'));
const socket = join(base,'socket'), data = join(base,'data');
const connection = ci ? ['-h','localhost','-p','5432','-U','postgres'] : ['-h',socket,'-p','58723'];
const database = `dm_refinement_sale_episode_integrity_${process.pid}_${Date.now()}`;
assert.match(database,/^dm_refinement_sale_episode_integrity_[0-9]+_[0-9]+$/);
const psql = [...connection,'-X','-qAt','-d',database];
const sessions = [];
let started=false,created=false,sequence=0,concurrencyContracts=0;
let log='';
const query = sql => run('psql',[...psql,'-v','ON_ERROR_STOP=1','-c',sql]).trim();
function session(name) {
  const child=spawn(executable('psql'),[...psql,'-v','ON_ERROR_STOP=0'],
    {cwd:root,env:{...childEnv,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});
  const actor={child,output:'',errors:'',waiters:[]}; sessions.push(actor);
  child.stdout.on('data',chunk=>{
    actor.output+=chunk.toString();
    for(const w of [...actor.waiters])if(actor.output.includes(w.marker)){clearTimeout(w.timer);actor.waiters.splice(actor.waiters.indexOf(w),1);w.resolve(actor.output);}
  });
  child.stderr.on('data',chunk=>{actor.errors+=chunk.toString();});
  child.on('exit',code=>{for(const w of actor.waiters){clearTimeout(w.timer);w.reject(new Error(`Local session ${name} exited ${code}: ${actor.errors}`));}actor.waiters=[];});
  actor.wait = marker => new Promise((resolve,reject)=>{
    if(actor.output.includes(marker))return resolve(actor.output);
    const w={marker,resolve,reject,timer:setTimeout(()=>reject(new Error(`Local session timeout ${marker}: ${actor.errors}`)),5000)};
    actor.waiters.push(w);
  });
  actor.send = async sql => {
    const marker=`DONE_${++sequence}`;
    child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    return actor.wait(marker);
  };
  return actor;
}
function passed(label){log+=`PASS CONCURRENCY ${label}\n`;concurrencyContracts++;}
async function state(actor,sql,expected) {
  const marker=`STATE_${++sequence}`;
  actor.child.stdin.write(`${sql}\n\\echo ${marker}: :SQLSTATE\n`);
  const output=await actor.wait(`${marker}:`);
  assert(output.includes(`${marker}: ${expected}`),`Expected ${expected}: ${output.slice(-300)} ${actor.errors}`);
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  if (!ci) {
    mkdirSync(socket); run('initdb',['-D',data,'--auth=trust','--no-locale','-E','UTF8']);
    run('pg_ctl',['-D',data,'-l',join(base,'server.log'),'-o',`-k ${socket} -p 58723 -c listen_addresses=''`,'-w','start']);started=true;
  }
  const serverVersion=Number(run('psql',[...connection,'-X','-qAt','-d','postgres','-v','ON_ERROR_STOP=1','-c','SHOW server_version_num']).trim());
  assert(serverVersion>=170000 && serverVersion<180000,'Disposable PostgreSQL server version 17 required');
  // createdb must succeed; never reuse or delete a pre-existing database.
  run('createdb',[...connection,database]);created=true;
  assert.equal(query(`SELECT current_database()='${database}' AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','f'))`),'t','Only the newly created empty fixture database without auth schema may run');
  const fixture=spawnSync(executable('psql'),[...psql,'-v','ON_ERROR_STOP=1','-f','scripts/discovery/sale-episode-source-integrity-test.sql'],
    {cwd:root,env:childEnv,encoding:'utf8',maxBuffer:8*1024*1024});
  log+=`${fixture.stdout||''}\n${fixture.stderr||''}`;
  assert.equal(fixture.status,0,log.split('\n').slice(-15).join('\n'));
  const schemaContracts=(log.match(/NOTICE:\s+PASS /g)||[]).length;
  assert(schemaContracts>0,'Actual schema assertions required');
  const actorA=session('nuke-sale-episode-integrity-a'),actorB=session('nuke-sale-episode-integrity-b');
  for(const [label,update,restore] of [
    ['parent',"UPDATE public.vehicles SET is_public=false WHERE id=md5('vehicle-1')::uuid;","UPDATE public.vehicles SET is_public=true WHERE id=md5('vehicle-1')::uuid;"],
    ['source',"UPDATE public.observation_sources SET slug='bat-changed' WHERE slug='bat';","UPDATE public.observation_sources SET slug='bat' WHERE slug='bat-changed';"],
    ['event',"UPDATE public.vehicle_events SET final_price=1001 WHERE id=md5('episode-1')::uuid;","UPDATE public.vehicle_events SET final_price=1000 WHERE id=md5('episode-1')::uuid;"],
    ['capture',"UPDATE public.listing_page_snapshots SET html_sha256=repeat('b',64) WHERE id=md5('capture-1')::uuid;","UPDATE public.listing_page_snapshots SET html_sha256=encode(sha256(convert_to(html,'UTF8')),'hex') WHERE id=md5('capture-1')::uuid;"]
  ]) {
    await actorA.send('BEGIN; SET LOCAL ROLE service_role; SELECT public.synthetic_insert_default(1);');
    await actorB.send("BEGIN; SET LOCAL lock_timeout='150ms';");
    await state(actorB,update,'55P03');
    await actorB.send('ROLLBACK;');passed(`${label} mutation blocked while admission holds SHARE lock`);
    await actorA.send('COMMIT;');
    await state(actorB,update,'00000');
    assert.equal(query("SELECT (structured_data=(SELECT payload->'structured_data' FROM public.synthetic_inputs WHERE n=1)) FROM public.vehicle_observations WHERE id=md5('claim-1')::uuid"),'t');
    passed(`${label} remains mutable after commit; original claim is preserved, not silently updated`);
    await actorB.send(restore);
    query('DELETE FROM public.vehicle_observations WHERE source_vehicle_event_id IS NOT NULL;');
  }
  for(const [label,update,restore] of [
    ['event',"UPDATE public.vehicle_events SET final_price=1001 WHERE id=md5('episode-1')::uuid;","UPDATE public.vehicle_events SET final_price=1000 WHERE id=md5('episode-1')::uuid;"],
    ['capture',"UPDATE public.listing_page_snapshots SET html_sha256=repeat('b',64) WHERE id=md5('capture-1')::uuid;","UPDATE public.listing_page_snapshots SET html_sha256=encode(sha256(convert_to(html,'UTF8')),'hex') WHERE id=md5('capture-1')::uuid;"]
  ]) {
    await actorA.send(`BEGIN; ${update}`);
    await actorB.send('BEGIN; SET LOCAL ROLE service_role;');
    await state(actorB,'SELECT public.synthetic_insert_default(1);','55P03');
    await actorB.send('ROLLBACK;');passed(`${label} mutator-first admission refuses immediately`);
    await actorA.send('COMMIT;');
    await actorB.send('BEGIN; SET LOCAL ROLE service_role;');
    await state(actorB,'SELECT public.synthetic_insert_default(1);','23514');
    await actorB.send('ROLLBACK;');passed(`${label} stale producer tuple refuses after mutator commits`);
    await actorA.send(restore);
    assert.equal(query('SELECT count(*) FROM public.vehicle_observations WHERE source_vehicle_event_id IS NOT NULL'),'0');
  }
  await actorA.send('BEGIN; SET LOCAL ROLE service_role; SELECT public.synthetic_insert_default(1);');
  await actorB.send("BEGIN; SET LOCAL ROLE service_role; SET LOCAL lock_timeout='3s';");
  const replayMarker=`REPLAY_${++sequence}`;
  actorB.child.stdin.write(`SELECT public.synthetic_insert_episode((SELECT payload||jsonb_build_object('id',md5('race-duplicate')::uuid) FROM public.synthetic_inputs WHERE n=1));\n\\echo ${replayMarker}: :SQLSTATE\n`);
  let blocked=false;
  for(let n=0;n<40&&!blocked;n++) {
    blocked=query("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE application_name='nuke-sale-episode-integrity-b' LIMIT 1")==='t';
    if(!blocked)await pause(20);
  }
  assert(blocked,'Actual concurrent duplicate must wait on the complete source replay tuple');
  await actorA.send('COMMIT;');
  const replay=await actorB.wait(`${replayMarker}:`);
  assert(replay.includes(`${replayMarker}: 23505`),replay.slice(-300));
  await actorB.send('ROLLBACK;');
  assert.equal(query("SELECT count(*) FROM public.vehicle_observations WHERE source_vehicle_event_id=md5('episode-1')::uuid"),'1');
  passed('concurrent complete source/id/kind/hash replay yields one original row, duplicate 23505');
  for(const actor of sessions){actor.child.stdin.end();await new Promise(resolve=>actor.child.once('exit',resolve));}
  writeFileSync(process.env.SALE_EPISODE_TEST_LOG||join(base,'fixture.log'),log);
  console.log(JSON.stringify({stage:ci?'ci_actual_pg17_schema_and_concurrency_passed':'local_actual_pg17_schema_and_concurrency_passed',schemaContracts,concurrencyContracts,
    productionConnected:false,admittedEpisodeV2Method:false,writerChanged:false}));
} catch(error) {
  if(existsSync(join(base,'server.log')))log+=readFileSync(join(base,'server.log'),'utf8');
  writeFileSync(process.env.SALE_EPISODE_TEST_LOG||join(base,'fixture.log'),log);
  throw error;
} finally {
  for(const actor of sessions)if(actor.child.exitCode===null)actor.child.kill('SIGTERM');
  if(created)run('dropdb',[...connection,database]);
  if(started||existsSync(join(data,'postmaster.pid')))run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  rmSync(base,{recursive:true,force:true});
}
