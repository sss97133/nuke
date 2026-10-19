#!/usr/bin/env node
/**
 * Laptop side of the dedicated-browser capture: fetch finished packets from the capture machine's spool over ssh,
 * land each through the existing canonical writer (fb-import-urls --capture --land, which needs the Nuke keys that
 * stay on this laptop), keep the packet, its receipts and an ACK locally, and only then release the remote copy.
 * A packet that fails to land stays on both sides and is retried with the same capture_id.
 *   node --import tsx pull-spool.mjs        (single instance; launchd every 5 minutes)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateCapture } from '../../../supabase/functions/extract-facebook-marketplace/capture.ts';
import { runCli } from '../bridge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = {
  ssh: ['-i', process.env.NUKE_FB_SSH_KEY ?? path.join(os.homedir(), '.ssh/nuke-cracked-mac'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'],
  host: process.env.NUKE_FB_HOST ?? 'skylarwilliams@CRACKED-MAC.local',
  remote: process.env.NUKE_FB_REMOTE ?? 'nuke-fb',
  dir: process.env.NUKE_FB_LOCAL ?? path.join(os.homedir(), 'nuke-logs/fb-playwright'),
  node: process.env.NUKE_NODE ?? '/opt/homebrew/bin/node', dotenvx: '/opt/homebrew/bin/dotenvx',
  cli: path.resolve(here, '../../fb-import-urls.ts'), envCwd: path.join(os.homedir(), 'nuke'),
};
const sh = (args, input) => spawnSync('ssh', [...cfg.ssh, cfg.host, ...args], { encoding: 'utf8', input, timeout: 60000 });
fs.mkdirSync(path.join(cfg.dir, 'captures'), { recursive: true, mode: 0o700 });

export function checkAck(packet, receipt) {
  const n = packet.batch.length, c = receipt?.counts;
  return !!(receipt?.success && receipt.capture_id === packet.capture.capture_id && c && c.errors === 0 && c.raw_landed === n && c.listings_landed === n && c.sightings_landed === n);
}
async function main() {
  const lock = path.join(cfg.dir, 'pull.lock');
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); } catch { try { process.kill(Number(fs.readFileSync(lock, 'utf8')), 0); return; } catch { fs.writeFileSync(lock, String(process.pid)); } }
  try {
    const listing = sh([`ls ${cfg.remote}/spool/out 2>/dev/null | grep -E '^[0-9a-f-]{36}\\.json$' || true`]);
    if (listing.status !== 0) { console.error('ssh_unavailable'); process.exitCode = 1; return; }
    for (const name of listing.stdout.split('\n').filter(Boolean).slice(0, 8)) {
      const file = path.join(cfg.dir, 'captures', name), ackFile = `${file}.ack.json`;
      if (!fs.existsSync(file)) {
        const got = sh([`cat ${cfg.remote}/spool/out/${name}`]); if (got.status !== 0) continue;
        fs.writeFileSync(file, got.stdout, { flag: 'wx', mode: 0o600 });
      }
      const bytes = fs.readFileSync(file, 'utf8'), packet = JSON.parse(bytes);
      if (!fs.existsSync(ackFile)) {
        validateCapture(packet.capture, packet.batch);
        await runCli(cfg, file);
        const last = JSON.parse(fs.readFileSync(`${file}.prepared.json.receipts.jsonl`, 'utf8').trim().split('\n').at(-1));
        if (last.http_status !== 200 || !checkAck(packet, last.receipt)) { console.error('landing_not_acknowledged', name); continue; }
        fs.writeFileSync(ackFile, JSON.stringify({ success: true, capture_id: packet.capture.capture_id, counts: last.receipt.counts, packet_sha256: createHash('sha256').update(bytes).digest('hex'), acknowledged_at: new Date().toISOString() }), { mode: 0o600 });
      }
      sh([`mkdir -p ${cfg.remote}/spool/done && mv ${cfg.remote}/spool/out/${name} ${cfg.remote}/spool/done/${name}`]);
      console.log('landed', name, JSON.stringify(JSON.parse(fs.readFileSync(ackFile, 'utf8')).counts));
    }
  } finally { fs.rmSync(lock, { force: true }); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(e => { console.error(e.message); process.exitCode = 1; });
