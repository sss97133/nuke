import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validatePacket } from './extension/core.mjs';
import { validateCapture } from '../../supabase/functions/extract-facebook-marketplace/capture.ts';

export function validateCommand(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('invalid_command');
  if (message.command === 'ping' && Object.keys(message).length === 1) return message;
  if (message.command !== 'capture' || Object.keys(message).sort().join(',') !== 'command,packet') throw new Error('invalid_command');
  validatePacket(message.packet); validateCapture(message.packet.capture, message.packet.batch);
  return message;
}
export function validateOrigin(origin, extensionId) {
  if (!/^[a-p]{32}$/.test(extensionId) || origin !== `chrome-extension://${extensionId}/`) throw new Error('unapproved_extension_origin');
}
export function frame(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 250000) throw new Error('response_budget');
  const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
  return Buffer.concat([header, bytes]);
}
export function decodeFrame(buffer) {
  if (buffer.length < 4) return null;
  const size = buffer.readUInt32LE(0);
  if (!size || size > 220000) throw new Error('message_budget');
  if (buffer.length < size + 4) return null;
  if (buffer.length !== size + 4) throw new Error('multiple_commands_refused');
  return JSON.parse(buffer.subarray(4).toString('utf8'));
}
export function runCli(config, file) {
  return new Promise((resolve, reject) => {
    // All executable paths and arguments come from the local install config.
    // The browser supplies only a validated packet, never a shell command/path.
    const child = spawn(config.dotenvx, ['run', '-q', '--', config.node, '--import', 'tsx', config.cli, '--capture', file, '--land'], {
      cwd: config.envCwd, env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
    });
    let output = '', error = ''; const timer = setTimeout(() => child.kill('SIGTERM'), 150000);
    child.stdout.on('data', data => { output = (output + data).slice(-250000); });
    child.stderr.on('data', data => { error = (error + data).slice(-4000); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error('canonical_cli_failed')); else resolve(output); });
  });
}
export async function handleCommand(message, config, execute = runCli) {
  validateCommand(message);
  if (message.command === 'ping') return { success: true, protocol: 'nuke_marketplace_capture_v1', destination: 'existing_browser_capture_writer' };
  const packet = message.packet, id = packet.capture.capture_id;
  const bytes = JSON.stringify(packet);
  fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(config.stateDir, `${id}.json`), ackFile = `${file}.ack.json`;
  if (fs.existsSync(file)) { if (fs.readFileSync(file, 'utf8') !== bytes) throw new Error('changed_capture_replay'); }
  else {
    const pending = fs.readdirSync(config.stateDir).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name) && !fs.existsSync(path.join(config.stateDir, `${name}.ack.json`)));
    if (pending.length >= 8) throw new Error('host_queue_full');
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  }
  if (fs.existsSync(ackFile)) return JSON.parse(fs.readFileSync(ackFile, 'utf8'));
  const lock = `${file}.lock`;
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() })); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = JSON.parse(fs.readFileSync(lock, 'utf8'));
    try { process.kill(prior.pid, 0); throw new Error('capture_landing_in_progress'); }
    catch (error) { if (error.message === 'capture_landing_in_progress' || error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(lock); return handleCommand(message, config, execute);
  }
  try {
    await execute(config, file);
    const receipts = fs.readFileSync(`${file}.prepared.json.receipts.jsonl`, 'utf8').trim().split('\n');
    const last = JSON.parse(receipts.at(-1)), receipt = last.receipt, n = packet.batch.length;
    if (last.http_status !== 200 || !receipt?.success || receipt.capture_id !== id || receipt.observed_at !== packet.capture.observed_at || receipt.counts?.errors !== 0 || receipt.counts.raw_landed !== n || receipt.counts.listings_landed !== n || receipt.counts.sightings_landed !== n) throw new Error('canonical_ack_unavailable');
    if (packet.capture.retrieval_surface === 'chrome_mv3_rendered_saved_cards'
      && (receipt.counts.private_source !== n || receipt.counts.linked_observations !== 0)) throw new Error('saved_private_ack_unavailable');
    const ack = { success: true, capture_id: id, observed_at: receipt.observed_at, counts: receipt.counts,
      packet_sha256: createHash('sha256').update(bytes).digest('hex'), acknowledged_at: new Date().toISOString() };
    const temp = `${ackFile}.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(ack), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, ackFile);
    return ack;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
async function main() {
  const [configPath, origin] = process.argv.slice(2);
  if (process.argv.length !== 4 || !path.isAbsolute(configPath ?? '')) throw new Error('invalid_host_invocation');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  validateOrigin(origin, config.extensionId);
  for (const key of ['node','dotenvx','cli','stateDir','envCwd']) if (!path.isAbsolute(config[key] ?? '')) throw new Error('invalid_install_config');
  let input = Buffer.alloc(0), handled = false;
  process.stdin.on('data', chunk => {
    if (handled) return;
    input = Buffer.concat([input, chunk]);
    try {
      if (input.length > 220004) throw new Error('message_budget');
      const message = decodeFrame(input); if (!message) return; handled = true;
      handleCommand(message, config).then(value => process.stdout.write(frame(value), () => process.exit(0)), () => process.stdout.write(frame({ success: false, error: 'landing_unavailable_packet_retained' }), () => process.exit(1)));
    } catch { handled = true; process.stdout.write(frame({ success: false, error: 'invalid_message' }), () => process.exit(1)); }
  });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(() => { process.stderr.write('Native capture host refused invocation\n'); process.exitCode = 1; });
