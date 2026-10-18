#!/usr/bin/env node
// List the GPS-made organization links on one user's vehicles that auto_tag_organization_from_gps would not make
// today, and what to do with each.
//
//   node scripts/org-tagging/review-gps-org-links.mjs --user <uuid>                       # dry run (default)
//   dotenvx run -- node scripts/org-tagging/review-gps-org-links.mjs --apply <dry-run.jsonl>
//
// Since supabase/migrations/20261016203000_gps_org_tag_proposes_pending.sql a located photo is evidence: it proposes
// work_location (a pending_vehicle_assignments row) for the photographer's one organization within 150 m, and the
// owner's approve_pending_assignment makes the link. The old trigger wrote ACTIVE organization_vehicles rows instead.
// This script judges every such row still in place (active, auto_tagged work_location, not user-confirmed), and any
// active link on a triple the owner rejected, on the user's vehicles: the ones his photos are filed on and the ones
// he holds as user_id, owner_id or uploaded_by. Each photo of those vehicles is run through ruleFor() below, which
// mirrors the trigger, and each link gets one reason and one action:
//   previously_rejected      the owner rejected the triple   -> honor_rejection: user_rejected (his reviewer and
//                                                               time from the rejection), status pending
//   signed                   an approved assignment exists   -> keep
//   would_propose            a photo would propose it now     -> mark_pending_and_propose: status pending, plus the
//                                                               pending assignment the trigger would have written
//   no_photo_within_150m     no photo of the vehicle near it  -> mark_pending
//   non_member_org           photos near it, by non-members   -> mark_pending
//   ambiguous_site           members' photos, all at a site two of the photographer's organizations share
//                                                             -> mark_pending
//   outside_window           sole-site photos, all outside the photographer's recorded holding -> mark_pending
// organization_vehicles has no superseded_by; status (with 'pending' unused on 2026-10-15) and user_rejected are its
// mechanism. 'pending' takes a row off the organization page (OrganizationProfile reads active, sold, archived) and
// approve_pending_assignment sets it active again. No row is deleted.
//
// The dry run only reads, through scripts/data/q.sh inside a read-only transaction, at the role's 10 s statement
// timeout, one read at a time, a vehicle's photos 300 at a time, and writes one JSONL line per link plus a summary under
// ~/nuke-logs/org-tagging-20261015/ (ORG_TAGGING_LOG_DIR overrides). --apply reads such a file and writes only its
// rows, each guarded on the state the dry run saw (still active, auto_tagged as seen, not user-confirmed), 50 at a
// time, through supabase-js as service role, and logs every result beside it.
import { appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureDir, pg, utcStamp } from '../stacks/lib/common.mjs';

export const RADIUS_M = 150;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG_DIR = process.env.ORG_TAGGING_LOG_DIR || join(homedir(), 'nuke-logs', 'org-tagging-20261015');
const PAGE = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = ids => ids.map(id => `'${id}'`).join(',');

export function metres(lat1, lon1, lat2, lon2) {
  const rad = d => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// What the trigger does with one photo, given the small tables it reads. ctx: memberships (user -> [{organization_id,
// status, end_date}]), points (organization -> [{location_id, lat, lon}]), decided (Set of 'vehicle|org' with a
// rejected or approved work_location assignment, or a user_rejected/user_confirmed link), windows (vehicle|user ->
// [{start_date, end_date}]). Returns { verdict, org, location_id, metres, orgs }.
export function ruleFor(photo, ctx) {
  if (!photo.vehicle_id || !photo.user_id || photo.lat == null || photo.lon == null) return { verdict: 'incomplete' };
  if (photo.is_superseded) return { verdict: 'superseded' };
  if (photo.gate === 'rejected_personal' || photo.gate === 'rejected_misattributed') return { verdict: 'gate_rejected' };
  const day = photo.taken_at ? String(photo.taken_at).slice(0, 10) : null;
  const near = new Map();
  const mine = [];
  for (const m of ctx.memberships.get(photo.user_id) ?? []) {
    if ((m.status ?? 'active') !== 'active') continue;
    if (m.end_date && !(day && day <= m.end_date)) continue;
    for (const p of ctx.points.get(m.organization_id) ?? []) {
      mine.push({ organization_id: m.organization_id, ...p });
      if (Math.abs(p.lat - photo.lat) >= 0.01) continue;
      const d = metres(photo.lat, photo.lon, p.lat, p.lon);
      if (d > RADIUS_M) continue;
      const best = near.get(m.organization_id);
      if (!best || d < best.metres) near.set(m.organization_id, { location_id: p.location_id, metres: d, lat: p.lat, lon: p.lon });
    }
  }
  const orgs = [...near.keys()];
  if (orgs.length === 0) return { verdict: 'no_candidate', orgs };
  if (orgs.length > 1) return { verdict: 'ambiguous_site', orgs };
  const [org] = orgs;
  const { lat, lon, ...point } = near.get(org);
  // Another of his organizations within the radius of the matched point: the far edge of a shared lot.
  if (mine.some(p => p.organization_id !== org && Math.abs(p.lat - lat) < 0.01 && metres(lat, lon, p.lat, p.lon) <= RADIUS_M)) {
    return { verdict: 'ambiguous_site', orgs };
  }
  const hit = { org, orgs, ...point };
  if (ctx.decided.has(`${photo.vehicle_id}|${org}`)) return { verdict: 'decided', ...hit };
  const windows = ctx.windows.get(`${photo.vehicle_id}|${photo.user_id}`);
  if (windows && !windows.some(w => day && (!w.start_date || day >= w.start_date) && (!w.end_date || day <= w.end_date))) {
    return { verdict: 'outside_window', ...hit };
  }
  return { verdict: 'propose', ...hit };
}

// One reason and one action for a link, from its rejection/approval and the photos of its vehicle.
export function judgeLink(link, photos, ctx) {
  const tally = { photos_located: 0, photos_near: 0, photos_member_near: 0, photos_sole: 0, photos_would_propose: 0 };
  let evidence = null;
  const memberOf = (user, day) => (ctx.memberships.get(user) ?? []).some(m => m.organization_id === link.organization_id
    && (m.status ?? 'active') === 'active' && (!m.end_date || (day && day <= m.end_date)));
  for (const photo of photos) {
    const rule = ruleFor(photo, ctx);
    if (['incomplete', 'superseded', 'gate_rejected'].includes(rule.verdict)) continue;
    tally.photos_located += 1;
    const isNear = (ctx.points.get(link.organization_id) ?? [])
      .some(p => Math.abs(p.lat - photo.lat) < 0.01 && metres(photo.lat, photo.lon, p.lat, p.lon) <= RADIUS_M);
    if (!isNear) continue;
    tally.photos_near += 1;
    if (!memberOf(photo.user_id, photo.taken_at ? String(photo.taken_at).slice(0, 10) : null)) continue;
    tally.photos_member_near += 1;
    if (rule.org !== link.organization_id) continue;
    tally.photos_sole += 1;
    if (rule.verdict !== 'propose') continue;
    tally.photos_would_propose += 1;
    if (!evidence || rule.metres < evidence.distance_m) {
      evidence = { image_id: photo.id, organization_location_id: rule.location_id, distance_m: Math.round(rule.metres * 10) / 10,
        taken_at: photo.taken_at, user_id: photo.user_id };
    }
  }
  let reason;
  if (link.rejection || link.user_rejected) reason = 'previously_rejected';
  else if (link.approved) reason = 'signed';
  else if (tally.photos_would_propose > 0) reason = 'would_propose';
  else if (tally.photos_near === 0) reason = 'no_photo_within_150m';
  else if (tally.photos_member_near === 0) reason = 'non_member_org';
  else if (tally.photos_sole === 0) reason = 'ambiguous_site';
  else reason = 'outside_window';
  const action = { previously_rejected: 'honor_rejection', signed: 'keep', would_propose: 'mark_pending_and_propose' }[reason]
    ?? 'mark_pending';
  return { reason, action, ...tally, evidence: reason === 'would_propose' ? evidence : null };
}

// One read at a time, at least 1.2 s apart (the Management API throttles bursts); a throttled or timed-out read is
// retried with a growing pause.
let lastRead = 0;
async function q(sql) {
  for (let attempt = 1; ; attempt += 1) {
    await sleep(Math.max(0, lastRead + 1200 - Date.now()));
    lastRead = Date.now();
    try { return await pg(sql, { timeoutS: 10 }); } catch (error) {
      if (attempt >= 6) throw error;
      await sleep(5000 * attempt);
    }
  }
}

async function vehicleSet(user) {
  const filed = await q(`select vehicle_id id from vehicle_images where user_id = '${user}' and vehicle_id is not null group by 1`);
  const held = await q(`select id from vehicles where user_id = '${user}'
    union select id from vehicles where owner_id = '${user}' union select id from vehicles where uploaded_by = '${user}'`);
  return { filed: filed.map(r => r.id), held: held.map(r => r.id), all: [...new Set([...filed, ...held].map(r => r.id))] };
}

async function photosOf(vehicleId) {
  const rows = [];
  for (let cursor = null; ;) {
    const after = cursor ? `and created_at <= '${cursor.created_at}' and (created_at, id) < ('${cursor.created_at}', '${cursor.id}')` : '';
    const page = await q(`select id, user_id, latitude::float8 lat, longitude::float8 lon, taken_at, is_superseded,
        vision_gate_status::text gate, created_at
      from vehicle_images where vehicle_id = '${vehicleId}' and created_at is not null ${after}
      order by created_at desc, id desc limit ${PAGE}`);
    rows.push(...page);
    if (page.length < PAGE) break;
    cursor = page[page.length - 1];
  }
  rows.push(...await q(`select id, user_id, latitude::float8 lat, longitude::float8 lon, taken_at, is_superseded,
      vision_gate_status::text gate from vehicle_images where vehicle_id = '${vehicleId}' and created_at is null limit ${PAGE}`));
  return rows.map(r => ({ ...r, vehicle_id: vehicleId }));
}

async function dryRun(user) {
  const started = new Date();
  const set = await vehicleSet(user);
  const links = [];
  for (let i = 0; i < set.all.length; i += 100) {
    links.push(...await q(`select ov.id, ov.organization_id, ov.vehicle_id, ov.relationship_type, ov.status, ov.auto_tagged,
        ov.user_rejected, ov.linked_by_user_id, ov.gps_match_confidence, ov.location_id, ov.created_at, ov.updated_at,
        o.business_name
      from organization_vehicles ov left join organizations o on o.id = ov.organization_id
      where ov.vehicle_id in (${list(set.all.slice(i, i + 100))})
        and coalesce(ov.status, 'active') = 'active' and not coalesce(ov.user_confirmed, false)`));
  }
  const decisions = [];
  for (let i = 0; i < set.all.length; i += 100) {
    decisions.push(...await q(`select id, vehicle_id, organization_id, suggested_relationship_type rel, status,
        reviewed_by_user_id, reviewed_at from pending_vehicle_assignments
      where vehicle_id in (${list(set.all.slice(i, i + 100))}) and status in ('rejected', 'approved')`));
  }
  const decisionOf = (l, status) => decisions.filter(d => d.vehicle_id === l.vehicle_id && d.organization_id === l.organization_id
    && d.rel === l.relationship_type && d.status === status).sort((a, b) => String(b.reviewed_at).localeCompare(String(a.reviewed_at)))[0];
  const scoped = links.map(l => ({ ...l, rejection: decisionOf(l, 'rejected') ?? null, approved: Boolean(decisionOf(l, 'approved')) }))
    .filter(l => (l.relationship_type === 'work_location' && l.auto_tagged) || l.rejection || l.user_rejected);

  const memberRows = await q(`select organization_id, user_id, status, end_date from organization_contributors where user_id is not null`);
  const memberships = new Map();
  for (const m of memberRows) memberships.set(m.user_id, [...(memberships.get(m.user_id) ?? []), m]);
  const orgIds = [...new Set([...scoped.map(l => l.organization_id), ...memberRows.map(m => m.organization_id)])];
  const pointRows = orgIds.length ? await q(`select l.organization_id, l.id location_id, l.latitude::float8 lat, l.longitude::float8 lon
      from organization_locations l where l.organization_id in (${list(orgIds)}) and l.latitude is not null and l.longitude is not null
    union all
    select o.id, null, o.latitude::float8, o.longitude::float8 from organizations o
      where o.id in (${list(orgIds)}) and o.latitude is not null and o.longitude is not null
        and not exists (select 1 from organization_locations l where l.organization_id = o.id and l.latitude is not null and l.longitude is not null)`) : [];
  const points = new Map();
  for (const p of pointRows) points.set(p.organization_id, [...(points.get(p.organization_id) ?? []), p]);
  const scopedVehicles = [...new Set(scoped.map(l => l.vehicle_id))];
  const windowRows = scopedVehicles.length ? await q(`select vehicle_id, owner_profile_id, start_date, end_date from vehicle_ownerships
      where vehicle_id in (${list(scopedVehicles)})`) : [];
  const windows = new Map();
  for (const w of windowRows) {
    const key = `${w.vehicle_id}|${w.owner_profile_id}`;
    windows.set(key, [...(windows.get(key) ?? []), w]);
  }
  // The trigger reads a user_rejected or user_confirmed work_location link in any status.
  const flagged = [];
  for (let i = 0; i < scopedVehicles.length; i += 100) {
    flagged.push(...await q(`select vehicle_id, organization_id from organization_vehicles
      where vehicle_id in (${list(scopedVehicles.slice(i, i + 100))}) and relationship_type = 'work_location'
        and (coalesce(user_rejected, false) or coalesce(user_confirmed, false))`));
  }
  const decided = new Set([
    ...decisions.filter(d => d.rel === 'work_location').map(d => `${d.vehicle_id}|${d.organization_id}`),
    ...flagged.map(l => `${l.vehicle_id}|${l.organization_id}`),
  ]);
  const ctx = { memberships, points, decided, windows };

  ensureDir(LOG_DIR);
  const out = join(LOG_DIR, `review-gps-org-links-${utcStamp(started)}.jsonl`);
  const summary = { reasons: {}, actions: {}, photos_read: 0 };
  for (const [n, vehicleId] of scopedVehicles.entries()) {
    const photos = await photosOf(vehicleId);
    summary.photos_read += photos.length;
    for (const link of scoped.filter(l => l.vehicle_id === vehicleId)) {
      const verdict = judgeLink(link, photos, ctx);
      summary.reasons[verdict.reason] = (summary.reasons[verdict.reason] ?? 0) + 1;
      summary.actions[verdict.action] = (summary.actions[verdict.action] ?? 0) + 1;
      appendFileSync(out, JSON.stringify({ kind: 'link', link_id: link.id, vehicle_id: link.vehicle_id,
        organization_id: link.organization_id, organization: link.business_name, relationship_type: link.relationship_type,
        status: link.status, auto_tagged: link.auto_tagged, linked_by_user_id: link.linked_by_user_id,
        gps_match_confidence: link.gps_match_confidence, created_at: link.created_at, updated_at: link.updated_at,
        rejection: link.rejection && { id: link.rejection.id, by: link.rejection.reviewed_by_user_id, at: link.rejection.reviewed_at },
        ...verdict }) + '\n');
    }
    process.stderr.write(`vehicle ${n + 1}/${scopedVehicles.length}: ${photos.length} photos\n`);
  }
  const record = { kind: 'summary', mode: 'dry_run', user_id: user, started_at: started.toISOString(),
    finished_at: new Date().toISOString(), radius_m: RADIUS_M,
    vehicles: { filed_photos_on: set.filed.length, held: set.held.length, union: set.all.length, with_links_in_scope: scopedVehicles.length },
    active_unconfirmed_links_on_vehicles: links.length, links_in_scope: scoped.length, ...summary };
  appendFileSync(out, JSON.stringify(record) + '\n');
  console.log(JSON.stringify(record, null, 2));
  console.log(`log: ${out}`);
}

async function apply(file) {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run under dotenvx)');
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(r => r.kind === 'link' && r.action !== 'keep');
  const out = file.replace(/\.jsonl$/, '') + `.applied-${utcStamp()}.jsonl`;
  const tally = {};
  for (let i = 0; i < rows.length; i += 50) {
    for (const r of rows.slice(i, i + 50)) {
      const change = { status: 'pending', updated_at: new Date().toISOString() };
      if (r.action === 'honor_rejection') {
        Object.assign(change, { user_rejected: true, user_rejected_by: r.rejection?.by ?? null, user_rejected_at: r.rejection?.at ?? null });
      }
      const { data, error } = await sb.from('organization_vehicles').update(change)
        .eq('id', r.link_id).eq('status', 'active').eq('auto_tagged', r.auto_tagged).eq('user_confirmed', false).select('id');
      let result = error ? `error: ${error.message}` : data.length === 1 ? 'updated' : 'skipped: row changed since the dry run';
      if (!error && data.length === 1 && r.action === 'mark_pending_and_propose' && r.evidence) {
        const confidence = Math.round(Math.max(0, Math.min(100, (1 - r.evidence.distance_m / RADIUS_M) * 100)) * 100) / 100;
        const proposal = await sb.from('pending_vehicle_assignments').upsert({
          vehicle_id: r.vehicle_id, organization_id: r.organization_id, suggested_relationship_type: 'work_location',
          overall_confidence: confidence, evidence_sources: ['gps', 'user_org_membership'], evidence_count: 2,
          confidence_breakdown: { gps: confidence, user_org_membership: 100, gps_evidence: { ...r.evidence, radius_m: RADIUS_M,
            rule: 'the only organization of the photographer within the radius', source: 'review-gps-org-links' } },
          suggested_by_system: true, suggested_by_user_id: r.evidence.user_id, status: 'pending', auto_approve_threshold: null,
        }, { onConflict: 'vehicle_id,organization_id,suggested_relationship_type,status', ignoreDuplicates: true });
        result += proposal.error ? `; proposal error: ${proposal.error.message}` : '; proposed';
      }
      tally[result] = (tally[result] ?? 0) + 1;
      appendFileSync(out, JSON.stringify({ link_id: r.link_id, action: r.action, change, result }) + '\n');
    }
    await sleep(500);
  }
  console.log(JSON.stringify({ applied_from: file, rows: rows.length, tally }, null, 2));
  console.log(`log: ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const user = args[args.indexOf('--user') + 1];
  const applyFile = args.includes('--apply') ? args[args.indexOf('--apply') + 1] : null;
  if (applyFile) await apply(applyFile);
  else if (args.includes('--user') && UUID.test(user ?? '')) await dryRun(user);
  else {
    console.error('usage: review-gps-org-links.mjs --user <uuid> | --apply <dry-run.jsonl>');
    process.exit(2);
  }
}
