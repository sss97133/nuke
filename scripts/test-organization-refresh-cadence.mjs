// Actual activation migration, synthetic cron metadata only. Never production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
assert.match(process.env.PGDATABASE ?? '', /^dm_refinement_org_refresh_/);
function run(query) {
  return spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {input:query,encoding:'utf8'});
}
function sql(query) {
  const r=run(query);assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
sql(`DO $$ BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN RAISE EXCEPTION 'Requires empty disposable database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dm_org_refresh_deploy') THEN CREATE ROLE dm_org_refresh_deploy; END IF;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,schedule text,active boolean,command text);
CREATE TABLE cron.fixture_calls(jobid bigint);
CREATE FUNCTION cron.alter_job(job_id bigint,schedule text,active boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,cron AS $$
 BEGIN
 IF current_setting('transaction_isolation') <> 'serializable' THEN RAISE EXCEPTION 'Requires serializable activation'; END IF;
 IF current_setting('dm.org_refresh_barrier',true) = 'on' THEN PERFORM pg_advisory_xact_lock(263970); END IF;
 INSERT INTO cron.fixture_calls VALUES(job_id);
 UPDATE cron.job SET schedule=alter_job.schedule,active=alter_job.active WHERE jobid=job_id; END $$;
CREATE FUNCTION public.organization_listing_activity_candidates(integer) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE FUNCTION public.compute_organization_listing_activity(uuid) RETURNS void LANGUAGE sql AS 'SELECT';
REVOKE ALL ON FUNCTION public.organization_listing_activity_candidates(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organization_listing_activity_candidates(integer) TO service_role;
GRANT USAGE ON SCHEMA cron TO dm_org_refresh_deploy;
GRANT SELECT ON cron.job TO dm_org_refresh_deploy;
GRANT EXECUTE ON FUNCTION cron.alter_job(bigint,text,boolean) TO dm_org_refresh_deploy;`);
sql(`REVOKE ALL ON FUNCTION public.compute_organization_listing_activity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.compute_organization_listing_activity(uuid) TO service_role;`);
const productionHash='eidSpC4R4IQE1jlKoDOW1agaJoNZ4fHTXWot4k12bvQ=';
const source=readFileSync('supabase/migrations/20261011173725_resume_organization_activity_refresh.sql','utf8');
assert.equal(source.split(productionHash).length,2);
// Swap only the deployment-specific fingerprint for the synthetic command.
const hash=sql("SELECT encode(sha256(convert_to('fixture-worker-command','UTF8')),'base64')");
const migration='SET ROLE dm_org_refresh_deploy;\n'+source.replace(productionHash,hash);
const directLock=run('SET ROLE dm_org_refresh_deploy; SELECT * FROM cron.job FOR UPDATE;');
assert.notEqual(directLock.status,0);
assert.match(directLock.stderr,/permission denied for table job/,'Fixture must reproduce production cron permissions');
function fixture({active=false,schedule='0 4 * * *',command='fixture-worker-command',jobid=263}={}) {
 assert(!schedule.includes("'")&&!command.includes("'"));
 sql(`TRUNCATE cron.job,cron.fixture_calls;
 INSERT INTO cron.job VALUES(${jobid},'compute-org-seller-stats-daily','${schedule}',${active},'${command}'),
 (264,'other-paused-job','*/5 * * * *',false,'other-command');`);
}
function rejects(reason) {
 const before=sql('SELECT json_agg(j ORDER BY jobid) FROM cron.job j');
 const r=run(migration);assert.notEqual(r.status,0);assert.match(r.stderr,new RegExp(reason));
 assert.equal(sql('SELECT json_agg(j ORDER BY jobid) FROM cron.job j'),before);
 assert.equal(sql('SELECT count(*) FROM cron.fixture_calls'),'0');
}
fixture();sql(migration);
assert.equal(sql("SELECT schedule||':'||active||':'||command FROM cron.job WHERE jobid=263"),'*/10 * * * *:true:fixture-worker-command');
assert.equal(sql("SELECT schedule||':'||active||':'||command FROM cron.job WHERE jobid=264"),'*/5 * * * *:false:other-command');
sql(migration);assert.equal(sql('SELECT count(*) FROM cron.fixture_calls'),'1','Reapplication is a no-op');
fixture({command:'changed-command'});rejects('organization_refresh_command_changed');
fixture({schedule:'*/10 * * * *'});rejects('organization_refresh_pause_or_cadence_changed');
fixture({active:true});rejects('organization_refresh_pause_or_cadence_changed');
fixture({jobid:999});rejects('organization_refresh_job_changed');
fixture();sql('GRANT EXECUTE ON FUNCTION public.organization_listing_activity_candidates(integer) TO anon');
rejects('organization_listing_selector_access_changed');
sql('REVOKE EXECUTE ON FUNCTION public.organization_listing_activity_candidates(integer) FROM anon');
sql('REVOKE EXECUTE ON FUNCTION public.organization_listing_activity_candidates(integer) FROM service_role');
rejects('organization_listing_selector_access_changed');
sql('GRANT EXECUTE ON FUNCTION public.organization_listing_activity_candidates(integer) TO service_role');
sql('GRANT EXECUTE ON FUNCTION public.compute_organization_listing_activity(uuid) TO authenticated');
rejects('organization_listing_fold_access_changed');
sql('REVOKE EXECUTE ON FUNCTION public.compute_organization_listing_activity(uuid) FROM authenticated');
// Owner changes after the guard read must not be overwritten by activation.
function asyncSql(query) {
 const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:process.env});
 let stderr='';child.stderr.on('data',x=>stderr+=x);
 child.stdout.resume();child.stdin.end(query);
 return new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',status=>resolve({status,stderr}));
 });
}
fixture();
const owner=asyncSql("BEGIN; SELECT pg_advisory_xact_lock(263970); SELECT pg_sleep(2); UPDATE cron.job SET schedule='*/20 * * * *' WHERE jobid=263; COMMIT;");
for(let i=0;i<50;i++) {
 if(sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=263970 AND granted")==='1') break;
 if(i===49) throw new Error('Owner barrier did not start');
 await new Promise(resolve=>setTimeout(resolve,20));
}
const raced=asyncSql("SET dm.org_refresh_barrier='on';\n"+migration);
const [ownerResult,racedResult]=await Promise.all([owner,raced]);
assert.equal(ownerResult.status,0,ownerResult.stderr);
assert.notEqual(racedResult.status,0);
assert.match(racedResult.stderr,/could not serialize access due to concurrent update/);
assert.equal(sql("SELECT schedule||':'||active FROM cron.job WHERE jobid=263"),'*/20 * * * *:false');
assert.equal(sql('SELECT count(*) FROM cron.fixture_calls'),'0','Concurrent owner edit aborts activation atomically');
fixture();
sql('DROP FUNCTION public.compute_organization_listing_activity(uuid)');rejects('organization_listing_fold_not_installed');
console.log('Organization cadence activation, owner pause, command, privilege and idempotence contracts passed.');
