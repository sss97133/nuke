#!/usr/bin/env node
// Idempotent importer: existing local garage outputs -> public.garage_derivation_evidence (migration 20261111210000).
// Dry run by default (reads files, validates, prints counts per kind and run; no network). --apply sends the rows through PostgREST with
// SUPABASE_SERVICE_ROLE_KEY, `on conflict (dedupe_key) do nothing`, so re-running it, or importing a file twice, adds nothing.
//
//   node scripts/garage/import-derivation-evidence.mjs --workspace /workspace [--manifest /workspace/garage-artifact-inventory-*.json]
//   node scripts/garage/import-derivation-evidence.mjs --scene-labels a.jsonl,b.jsonl --place-matches p.jsonl --duplicates d.jsonl \
//        --seller-history h.jsonl [--vin-matches m.json] --exemplars e.json --sign s.jsonl --relationship-preview p.json [--apply]
//
// --workspace picks files by name: scene_labels*.jsonl, place7*.jsonl / place_matches*.jsonl (the run_match7* outputs; the *.r7a/.r7b
// snapshots are skipped), dupjudge*.jsonl / visual_dup*.jsonl, viva_history*.jsonl / bat_history*.jsonl (+ viva_vin_matches.json),
// place_exemplars*.json, sign*.jsonl, preview_out*.json. --manifest verifies each imported file's sha256 against the inventory and says which drifted
// (files change while producers run; the importer imports what is on disk and records the file name in evidence.imported_from).
// run_id: rows keep their own run_id when they have one; files without one (exemplars, seller history, role previews) get a run id derived from
// the file name, so a rollback by run_id undoes exactly one file. producer_version is 'unversioned-import:<script>': the producing commit is unknown.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fromDuplicateJudgment, fromPlaceExemplar, fromPlaceMatch, fromRelationshipRole, fromSceneLabel, fromSellerHistory, fromSignRead, insertRows, sha256 } from './derivation-evidence.mjs';

export const IMPORTER = 'import-derivation-evidence.mjs/1';
const PROJECT_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable uuid from text (sha-256 bytes with version/variant bits set).
export function uuidFrom(text) {
  const h = createHash('sha256').update(text).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
export const fileRunId = (kind, file) => uuidFrom(`garage-import:${kind}:${basename(file)}`);

export const parseJsonl = (text) => text.split('\n').filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch (e) { throw new Error(`line ${i + 1}: ${e.message}`); } });

// File name -> kind. Returns null for files that are not garage outputs (cte.sql, logs, snapshots, scripts).
export function classify(name) {
  const n = basename(name);
  if (/\.(r7[a-z]|bak|cte\.sql|log|sh|out|done)$/.test(n)) return null;
  if (/^scene_labels.*\.jsonl$/.test(n)) return 'scene_label';
  if (/^(place7[a-z]*(_[a-z0-9]+)?|place_matches.*)\.jsonl$/.test(n)) return 'place_match';
  if (/^(dupjudge.*|visual_dup.*)\.jsonl$/.test(n)) return 'duplicate_judgment';
  if (/^(viva_history|bat_history).*\.jsonl$/.test(n)) return 'seller_history_match';
  if (/^place_exemplars.*\.json$/.test(n)) return 'place_exemplar';
  if (/^sign.*\.jsonl$/.test(n)) return 'sign_read';
  if (/^preview_out.*\.json$/.test(n)) return 'relationship_role';
  return null;
}

// Rows of one file -> evidence rows. `skipped` lists rows that could not be mapped, with the reason (never guessed).
export function mapFile(kind, file, { text, mtime, vinMatches = new Map() }) {
  const ctxFor = (script) => ({ version: `unversioned-import:${script}`, importedFrom: { file: basename(file), importer: IMPORTER } });
  const rows = []; const skipped = []; const observedAt = mtime;
  const keep = (fn, src, i) => { try { rows.push(fn()); } catch (e) { skipped.push({ i, reason: e.message }); } };
  if (kind === 'place_exemplar' || kind === 'relationship_role') {
    const data = JSON.parse(text); const runId = fileRunId(kind, file);
    if (!Array.isArray(data)) throw new Error('expected a JSON array');
    if (kind === 'place_exemplar') {
      const script = 'scripts/garage/build-place-exemplars.mjs';
      data.forEach((p, i) => (p.exemplars ?? []).forEach((ex, j) => keep(() => fromPlaceExemplar(p, ex, { runId, script, observedAt }, ctxFor(script)), ex, `${i}.${j}`)));
    } else {
      const script = 'scripts/garage/replay-relationship-derivations.mjs';
      data.forEach((r, i) => keep(() => fromRelationshipRole(r, { runId, script, observedAt, mode: 'dry_run' }, ctxFor(script)), r, i));
    }
    return { rows, skipped };
  }
  parseJsonl(text).forEach((r, i) => {
    if (kind === 'scene_label') keep(() => fromSceneLabel(r, ctxFor(r.producer ?? 'scripts/garage/label-scenes.mjs')), r, i);
    else if (kind === 'place_match') keep(() => fromPlaceMatch(r, ctxFor(r.producer ?? 'scripts/garage/match-places.mjs')), r, i);
    else if (kind === 'duplicate_judgment') keep(() => fromDuplicateJudgment(r, ctxFor(r.producer ?? 'scripts/garage/compare-duplicates.mjs')), r, i);
    else if (kind === 'sign_read') {
      const script = r.producer ?? 'scripts/garage/mine-sign-evidence.mjs'; // the sign file has no run of its own: one run per file
      keep(() => fromSignRead({ ...r, run_id: fileRunId(kind, file), created_at: observedAt }, ctxFor(script)), r, i);
    } else if (kind === 'seller_history_match') {
      const script = 'scripts/garage/ingest-bat-seller-history.mjs'; const m = vinMatches.get(r.url);
      keep(() => fromSellerHistory(r, { runId: fileRunId(kind, file), script, vehicleId: m?.vehicle_id ?? null, matchedBy: m ? 'vin_equal' : null, observedAt }, ctxFor(script)), r, i);
    }
  });
  return { rows, skipped };
}

export function discover(dir) {
  return readdirSync(dir).map((n) => ({ file: join(dir, n), kind: classify(n) })).filter((x) => x.kind && statSync(x.file).isFile() && statSync(x.file).size > 0)
    .sort((a, b) => (a.file < b.file ? -1 : 1));
}

export function manifestDrift(manifestPath, files) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')); const byName = new Map((m.files ?? []).map((f) => [basename(f.path), f]));
  return files.filter((f) => byName.has(basename(f))).map((f) => ({ file: basename(f), listed: byName.get(basename(f)).sha256, current: sha256f(f) }));
}
const sha256f = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
  const list = (n) => (opt(n) ?? '').split(',').filter(Boolean);
  const apply = args.includes('--apply');
  const jobs = [];
  // With --manifest, a workspace file is imported only if the inventory lists it (the workspace holds many superseded drafts, e.g. preview_out3..21),
  // except place-match outputs: the run_match7*.sh scripts write place7*_N.jsonl, which the inventory lists only as scripts and empty .out files.
  const listed = opt('manifest') ? new Set((JSON.parse(readFileSync(opt('manifest'), 'utf8')).files ?? []).map((f) => basename(f.path))) : null;
  if (opt('workspace')) jobs.push(...discover(opt('workspace')).filter((j) => !listed || j.kind === 'place_match' || listed.has(basename(j.file))));
  const explicit = { scene_label: 'scene-labels', place_match: 'place-matches', duplicate_judgment: 'duplicates', seller_history_match: 'seller-history',
    place_exemplar: 'exemplars', sign_read: 'sign', relationship_role: 'relationship-preview' };
  for (const [kind, flag] of Object.entries(explicit)) for (const file of list(flag)) jobs.push({ file, kind });
  if (!jobs.length) { console.error('usage: import-derivation-evidence.mjs --workspace <dir> | --scene-labels f --place-matches f --duplicates f --seller-history f --exemplars f --sign f --relationship-preview f  [--vin-matches f] [--manifest inventory.json] [--apply]'); process.exit(2); }
  const seen = new Set(); const uniq = jobs.filter((j) => (seen.has(j.file) ? false : seen.add(j.file)));
  const vinFile = opt('vin-matches') ?? (opt('workspace') && existsSync(join(opt('workspace'), 'viva_vin_matches.json')) ? join(opt('workspace'), 'viva_vin_matches.json') : null);
  const vinMatches = new Map(vinFile ? JSON.parse(readFileSync(vinFile, 'utf8')).filter((m) => m.url && UUID.test(m.vehicle_id ?? '')).map((m) => [m.url, m]) : []);
  if (opt('manifest')) for (const d of manifestDrift(opt('manifest'), uniq.map((j) => j.file))) console.error(`manifest ${d.listed === d.current ? 'matches' : 'DRIFTED'}: ${d.file}`);

  const all = new Map(); const perKind = {}; const perRun = new Map(); let skipped = 0; let bad = 0;
  for (const { file, kind } of uniq) {
    let mapped;
    try { mapped = mapFile(kind, file, { text: readFileSync(file, 'utf8'), mtime: statSync(file).mtime.toISOString(), vinMatches }); }
    catch (e) { console.error(`${kind.padEnd(20)} FAILED ${basename(file)}: ${e.message}`); bad++; continue; }
    const { rows, skipped: sk } = mapped;
    for (const r of rows) {
      all.set(r.dedupe_key, r);
      const p = perKind[kind] ?? (perKind[kind] = { files: 0, rows: 0 }); p.rows++;
      perRun.set(r.run_id, { kind, n: (perRun.get(r.run_id)?.n ?? 0) + 1 });
    }
    (perKind[kind] ?? (perKind[kind] = { files: 0, rows: 0 })).files++;
    skipped += sk.length;
    console.error(`${kind.padEnd(20)} ${String(rows.length).padStart(6)} rows ${sk.length ? `(${sk.length} skipped: ${sk[0].reason}) ` : ''}${basename(file)}`);
  }
  const rows = [...all.values()];
  console.error(`\n${rows.length} distinct conclusions (${uniq.length} files, ${perRun.size} runs, ${skipped} skipped)`);
  for (const [k, v] of Object.entries(perKind)) console.error(`  ${k}: ${v.files} files, ${v.rows} rows`);
  if (bad) { console.error(`${bad} file(s) could not be read; nothing sent`); process.exit(1); }
  if (!apply) { console.error('dry run: nothing sent. Add --apply (needs SUPABASE_SERVICE_ROLE_KEY) to write; rerunning is safe.'); return; }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? PROJECT_URL;
  let sent = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const r = await insertRows(rows.slice(i, i + 200), { url, key });
    if (!r.ok) { console.error(`batch at ${i} failed: ${r.error}; rerun to resume (already-sent rows are ignored)`); process.exit(1); }
    sent += r.sent;
  }
  console.error(`sent ${sent} rows (rows already present are ignored by dedupe_key)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
