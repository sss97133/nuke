#!/usr/bin/env node
/**
 * Choose which landed Facebook listings the capture machine should look at again, to learn when each one ends.
 * Read-only against the database (scripts/data/q.sh). Policy: tier 1 (1964-73) before tier 2, newest first within a
 * tier; first look once a listing is 3 h old, then once a day, for 45 days or until a revisit records it gone.
 * Local state (not the database) remembers when each id was last handed out. Skips if the machine still holds a list.
 *   node make-revisit-list.mjs        (laptop; launchd hourly)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.NUKE_FB_LOCAL ?? path.join(os.homedir(), 'nuke-logs/fb-playwright');
const host = process.env.NUKE_FB_HOST ?? 'skylarwilliams@CRACKED-MAC.local', remote = process.env.NUKE_FB_REMOTE ?? 'nuke-fb';
const ssh = ['-i', process.env.NUKE_FB_SSH_KEY ?? path.join(os.homedir(), '.ssh/nuke-cracked-mac'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
const stateFile = path.join(dir, 'revisit-state.json');
fs.mkdirSync(dir, { recursive: true });

export function due(rows, state, now = Date.now(), limit = 12) {
  return rows.filter(r => {
    const last = state[r.facebook_id], age = now - Date.parse(r.first_seen_at);
    if (age < 3 * 3600_000 || age > 45 * 86400_000) return false;
    return !last || now - last >= 24 * 3600_000;
  }).sort((a, b) => (a.parsed_year <= 1973 ? 0 : 1) - (b.parsed_year <= 1973 ? 0 : 1) || Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at)).slice(0, limit).map(r => r.facebook_id);
}
function main() {
  const held = spawnSync('ssh', [...ssh, host, `test -e ${remote}/spool/in/revisit.json && echo held || true`], { encoding: 'utf8' });
  if (held.status !== 0) { console.error('ssh_unavailable'); process.exitCode = 1; return; }
  if (held.stdout.includes('held')) { console.log('list_still_held'); return; }
  const q = spawnSync(path.resolve(here, '../../data/q.sh'), ["select facebook_id, parsed_year, first_seen_at from marketplace_listings where platform='facebook_marketplace' and status='active' and removed_at is null and first_seen_at > now() - interval '45 days' and first_seen_at < now() - interval '3 hours' and parsed_year between 1964 and 1991 and raw_scrape_data ? 'browser_captures' order by first_seen_at desc limit 400"], { encoding: 'utf8' });
  let rows; try { rows = JSON.parse(q.stdout); if (!Array.isArray(rows)) throw new Error(q.stdout.slice(0, 200)); } catch (e) { console.error('query_failed', e.message); process.exitCode = 1; return; }
  let state = {}; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const ids = due(rows, state); if (!ids.length) { console.log('nothing_due', rows.length); return; }
  const put = spawnSync('ssh', [...ssh, host, `cat > ${remote}/spool/in/revisit.json.tmp && mv ${remote}/spool/in/revisit.json.tmp ${remote}/spool/in/revisit.json`], { input: JSON.stringify({ ids, made_at: new Date().toISOString() }), encoding: 'utf8' });
  if (put.status !== 0) { console.error('handoff_failed'); process.exitCode = 1; return; }
  for (const id of ids) state[id] = Date.now();
  fs.writeFileSync(stateFile, JSON.stringify(state)); console.log('handed_out', ids.length);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
