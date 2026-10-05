#!/usr/bin/env node
/** Apple Mail daemon: transport only; parsing/writes belong to ingest-mail-alerts.py.
 * No mailbox IDs, unread-state mutation, network redirect following or second parser.
 * Existing com.nuke.mail-intake LaunchAgent may run this every five minutes.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const daemon = args.includes('--daemon');
const readerArgs = args.filter(arg => !['--daemon', '--once'].includes(arg));
const reader = fileURLToPath(new URL('./ingest-mail-alerts.py', import.meta.url));
let child;
let stopping = false;
let timer;

function stop() {
  stopping = true;
  clearTimeout(timer);
  if (child) child.kill('SIGTERM');
  else process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function cycle() {
  child = spawn(process.env.MAIL_ALERT_PYTHON || 'python3', [reader, ...readerArgs], {
    stdio: 'inherit', env: process.env,
  });
  let finished = false;
  const finish = code => {
    if (finished) return;
    finished = true;
    child = undefined;
    if (stopping) process.exit(0);
    if (!daemon) process.exitCode = code;
    else {
      if (code) console.error(`Email intake failed (exit ${code}); next cycle will retry.`);
      timer = setTimeout(cycle, 5 * 60 * 1000);
    }
  };
  child.once('error', err => {
    console.error(`Could not start email intake: ${err.message}`);
    finish(1);
  });
  child.once('exit', code => finish(code ?? 1));
}
cycle();
