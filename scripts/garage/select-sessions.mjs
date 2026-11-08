#!/usr/bin/env node
// Session selection for the scene producers: which sessions to label next. A vehicle whose photo-weighted scene vote is LOW-INFORMATION gets
// ALL its sessions labelled; every other vehicle keeps a cap (default 6 sessions, the largest by photo count first).
//
//   node scripts/garage/select-sessions.mjs --sessions-json /workspace/scene_sessions.json [--labels-jsonl a.jsonl,b.jsonl]
//        [--out /workspace/scene_sessions_to_label.json] [--report-out /workspace/scene_selection_report.json]
//        [--cap 6] [--all-for-low-info] [--low-info-json <vehicle ids json>]
//
// Low-information (judged from the labels that exist, with the preview's vote rules: a session counts with its photos, labels outdoor_street /
// other and confidence < 0.6 are non-informative, two viewers count only when they agree), any of:
//   - no informative label (>= 0.6) among the vehicle's labelled sessions;
//   - the informative sessions hold less than 50% of the vehicle's session photos;
//   - only one of the vehicle's sessions is labelled.
// A vehicle with no label at all has not been judged yet: it gets the cap (a first pass) and is re-judged on the next run.
// --low-info-json adds vehicles (an array of ids or of {vehicle_id}) that are to be treated as low-information whatever the labels say.
// Output: the sessions still to label (already-labelled sessions are left out, whatever their vehicle's class), in the input row shape, so the
// file is a --sessions-json for label-scenes.mjs; the report lists every vehicle with its class, reasons and counts. Read-only.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NON_INFORMATIVE = ['outdoor_street', 'other'];
export const CONF_FLOOR = 0.6;

export const photosOf = (s) => Math.max(1, Number(s.photos ?? s.photo_count ?? s.image_ids?.length ?? 1) || 1);

// One decision per labelled session: the most confident label of viewer 1; with a viewer 2, they must agree (confidence = the lower one),
// else the session decides nothing.
export function sessionVerdicts(labels) {
  const by = new Map();
  for (const l of labels) {
    const k = `${l.vehicle_id}|${l.session_key}`; const v = (l.viewer ?? 1) === 2 ? 2 : 1;
    const e = by.get(k) ?? { 1: null, 2: null }; if (!e[v] || l.confidence > e[v].confidence) e[v] = l; by.set(k, e);
  }
  const out = new Map();
  for (const [k, e] of by) {
    const first = e[1] ?? e[2]; let label = first.scene_label; let conf = Number(first.confidence); let ok = true;
    if (e[1] && e[2]) { ok = e[1].scene_label === e[2].scene_label; conf = Math.min(conf, Number(e[2].confidence)); }
    out.set(k, { label, confidence: conf, informative: ok && conf >= CONF_FLOOR && !NON_INFORMATIVE.includes(label) });
  }
  return out;
}

export function classifyVehicle(sessions, verdicts, { forced = false } = {}) {
  const labelled = sessions.filter((s) => verdicts.has(`${s.vehicle_id}|${s.session_key}`));
  const total = sessions.reduce((n, s) => n + photosOf(s), 0);
  const informative = labelled.filter((s) => verdicts.get(`${s.vehicle_id}|${s.session_key}`).informative);
  const infoPhotos = informative.reduce((n, s) => n + photosOf(s), 0);
  const reasons = [];
  if (forced) reasons.push('listed_low_information');
  if (labelled.length) {
    if (!informative.length) reasons.push('no_informative_label');
    else if (infoPhotos * 2 < total) reasons.push('informative_weight_below_half');
    if (labelled.length === 1 && sessions.length > 1) reasons.push('only_one_session_labelled');
  }
  return { sessions: sessions.length, labelled: labelled.length, informative_sessions: informative.length, session_photos: total, informative_photos: infoPhotos,
    judged: labelled.length > 0, low_information: reasons.length > 0, reasons };
}

export function selectSessions(sessions, labels, { cap = 6, allForLowInfo = false, forcedIds = new Set() } = {}) {
  const verdicts = sessionVerdicts(labels);
  const byVehicle = new Map();
  for (const s of sessions) (byVehicle.get(s.vehicle_id) ?? byVehicle.set(s.vehicle_id, []).get(s.vehicle_id)).push(s);
  const toLabel = []; const report = [];
  for (const [vid, list] of byVehicle) {
    const cls = classifyVehicle(list, verdicts, { forced: forcedIds.has(vid) });
    const ordered = [...list].sort((a, b) => photosOf(b) - photosOf(a) || String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')) || String(a.session_key).localeCompare(String(b.session_key)));
    const all = allForLowInfo && cls.low_information;
    const chosen = all ? ordered : ordered.slice(0, cap);
    const pending = chosen.filter((s) => !verdicts.has(`${s.vehicle_id}|${s.session_key}`));
    toLabel.push(...pending);
    report.push({ vehicle_id: vid, ...cls, rule: all ? 'all_sessions' : `cap_${cap}`, selected: chosen.length, to_label: pending.length });
  }
  return { toLabel, report };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
  const inFile = opt('sessions-json');
  if (!inFile) { console.error('usage: select-sessions.mjs --sessions-json <file> [--labels-jsonl a.jsonl,b.jsonl] [--out f.json] [--report-out f.json] [--cap 6] [--all-for-low-info] [--low-info-json f.json]'); process.exit(2); }
  const out = opt('out', '/workspace/scene_sessions_to_label.json'); const reportOut = opt('report-out', out.replace(/\.json$/, '') + '.report.json');
  const cap = Number(opt('cap', 6)); if (!(cap >= 1)) { console.error('--cap must be >= 1'); process.exit(2); }
  const sessions = JSON.parse(readFileSync(inFile, 'utf8'));
  const labels = (opt('labels-jsonl', '') || '').split(',').filter(Boolean).filter((f) => existsSync(f))
    .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const forcedIds = new Set(opt('low-info-json') ? JSON.parse(readFileSync(opt('low-info-json'), 'utf8')).map((x) => (typeof x === 'string' ? x : x.vehicle_id)).filter((x) => UUID.test(x ?? '')) : []);
  const allForLowInfo = args.includes('--all-for-low-info');
  const { toLabel, report } = selectSessions(sessions, labels, { cap, allForLowInfo, forcedIds });
  writeFileSync(out, JSON.stringify(toLabel, null, 2)); writeFileSync(reportOut, JSON.stringify(report, null, 2));
  const low = report.filter((r) => r.low_information);
  console.error(`${report.length} vehicles, ${sessions.length} sessions; ${low.length} low-information (${low.filter((r) => r.rule === 'all_sessions').length} get all sessions), `
    + `${report.filter((r) => !r.judged).length} not yet judged (cap ${cap}); ${toLabel.length} sessions to label -> ${out}; report -> ${reportOut}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
