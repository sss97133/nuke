#!/usr/bin/env node
// Land ranked archived eBay Motors items through extract-ebay-motors {action: "archive"}. For each item the latest 200
// capture of its URL is chosen (an ended page states the outcome; an early capture may show it still running). Free.
// Resumable: items already in the log are skipped.
//
//   cd ~/nuke && dotenvx run -q -- node scripts/ebay-wayback/land.mjs <ranked.jsonl> <log.jsonl> [--limit 100] [--dry-run]
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const [rankedPath, logPath] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const limit = arg('--limit', 100), dryRun = process.argv.includes('--dry-run');
const fn = `${process.env.SUPABASE_URL}/functions/v1/extract-ebay-motors`, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!rankedPath || !logPath || !process.env.SUPABASE_URL || !key) { console.error('usage (under dotenvx): land.mjs <ranked.jsonl> <log.jsonl> [--limit N] [--dry-run]'); process.exit(2); }

const done = new Set(existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { const j = JSON.parse(l); return j.error ? null : j.item_id; } catch { return null; } }) : []);
const todo = readFileSync(rankedPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !done.has(r.item_id)).slice(0, limit);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function latestCapture(r) {
  const original = r.captures[0].original.replace(/^https?:\/\//, '').replace(/:80\//, '/');
  for (let t = 1; t <= 3; t++) {
    try {
      const res = await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(original)}&fl=timestamp,original&filter=statuscode:200&output=json`, { signal: AbortSignal.timeout(60_000) });
      const rows = (await res.json()).slice(1);
      if (rows.length) { const [timestamp, orig] = rows[rows.length - 1]; return { timestamp, original: orig, captures_seen: rows.length }; }
      break;
    } catch { await sleep(5000 * t); }
  }
  const c = r.captures[r.captures.length - 1];
  return { timestamp: c.timestamp, original: c.original, captures_seen: r.captures.length };
}

let streak = 0;
for (let i = 0; i < todo.length; i += 5) {
  const batch = todo.slice(i, i + 5), caps = [];
  for (const r of batch) { caps.push(await latestCapture(r)); await sleep(1100); }
  let out = null;
  for (let t = 1; t <= 3 && !out; t++) {
    try {
      const res = await fetch(fn, { method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', dry_run: dryRun, captures: caps.map(({ timestamp, original }) => ({ timestamp, original })) }), signal: AbortSignal.timeout(400_000) });
      out = await res.json();
    } catch (e) { if (t === 3) out = { ok: false, error: String(e) }; else await sleep(10_000 * t); }
  }
  batch.forEach((r, j) => {
    const res = out?.results?.[j] ?? { error: out?.error ?? 'no result' };
    const line = { item_id: r.item_id, score: r.score, title: r.title, capture: caps[j], dry_run: dryRun,
      outcome: res.outcome ?? res.page?.outcome ?? null, price: res.price ?? res.page?.priceShown ?? null, landed: res.landed ?? null,
      event: res.event ?? null, ended_at: res.ended_at ?? res.page?.endedAt ?? null, error: res.error ?? null };
    appendFileSync(logPath, JSON.stringify(line) + '\n');
    console.log(`${r.score} ${r.title.slice(0, 60)} -> ${line.outcome ?? '-'} ${line.price ?? ''} ${line.landed ?? ''} ${line.error ?? ''}`);
  });
  if (out?.errors?.length) console.log('  run errors:', out.errors.slice(0, 3).join(' | '));
  const failed = batch.filter((_, j) => (out?.results?.[j] ?? {}).error || !out?.results).length;
  streak = failed === batch.length ? streak + 1 : 0;
  if (streak >= 3) { console.log('STOP: three batches failed in a row (archive or function unavailable)'); process.exit(3); }
}
