#!/usr/bin/env node
// Run only production-shaped synthetic contracts on installed PG17. No network
// host, production credentials, downloads, migrations, or source testimony used.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bin = process.env.PG17_BIN || execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
const run = (name, args) => execFileSync(join(bin, name), args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
if (!/PostgreSQL\) 17\./.test(run('psql', ['--version']))) throw new Error('Installed PG17 required');
const reuse = process.env.SALE_EVENT_TEST_SOCKET;
const base = reuse ? dirname(realpathSync(reuse)) : mkdtempSync(join(tmpdir(), 'nuke-sale-event-pg-'));
if (reuse && !/^nuke-sale-event-pg-/.test(base.split('/').at(-1))) throw new Error('Only a task-specific local test socket may be reused');
const socket = join(base, 'socket');
const port = process.env.SALE_EVENT_TEST_PORT || '58719';
if (!/^[0-9]{4,5}$/.test(port) || +port < 1024 || +port > 65535) throw new Error('Invalid local test port');
const connection = ['-h', socket, '-p', port];
const database = `dm_refinement_sale_event_candidates_${process.pid}`;
let started = false, created = false;
try {
  if (!reuse) {
    mkdirSync(socket);
    run('initdb', ['-D', join(base, 'data'), '--auth=trust', '--no-locale', '-E', 'UTF8']);
    run('pg_ctl', ['-D', join(base, 'data'), '-l', join(base, 'server.log'), '-o', `-k ${socket} -p ${port} -c listen_addresses=''`, '-w', 'start']);
    started = true;
  }
  const dataDirectory = run('psql', ['-X', ...connection, '-d', 'postgres', '-Atc', 'SHOW data_directory']).trim();
  if (realpathSync(dataDirectory) !== realpathSync(join(base, 'data'))) throw new Error('Test socket does not belong to the task-specific cluster');
  run('createdb', [...connection, database]); created = true;
  const result = spawnSync(join(bin, 'psql'), ['-X', ...connection, '-d', database, '-v', 'ON_ERROR_STOP=1', '-f', 'scripts/discovery/sale-event-candidates-test.sql'],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = `${result.stdout || ''}\n${result.stderr || ''}`;
  writeFileSync(process.env.SALE_EVENT_TEST_LOG || join(base, 'fixture.log'), log);
  if (result.status !== 0) throw new Error(`Synthetic fixture failed: ${log.split('\n').slice(-12).join('\n')}`);
  const contractCount = (log.match(/NOTICE:\s+PASS /g) || []).length;
  if (contractCount === 0) throw new Error('No actual SQL assertions executed');
  const assertions = run('psql', ['-X', ...connection, '-d', database, '-Atc',
    "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sale_event_candidates'"]);
  if (assertions.trim() !== '0') throw new Error('Candidate fixture installed an unintended public DB function');
  console.log(JSON.stringify({ stage: 'synthetic_pg17_contract_passed', contracts: contractCount, productionConnected: false, installedPublicCandidateFunction: false }));
} catch (error) {
  if (error.stderr) process.stderr.write(String(error.stderr).split('\n').slice(-12).join('\n'));
  throw error;
} finally {
  if (created) run('dropdb', [...connection, database]);
  if (started) run('pg_ctl', ['-D', join(base, 'data'), '-m', 'fast', '-w', 'stop']);
  if (!reuse) rmSync(base, { recursive: true, force: true });
}
