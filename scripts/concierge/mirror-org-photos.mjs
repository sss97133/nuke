// Mirror org site/listing photos into concierge-media and ledger them in org_assets.
// Never hotlink a third party's CDN — same rule the instagram-connect sync follows.
//
// GATE NOTE — argued. This script writes `org_assets` rows, not a served column
// on `organizations`, so scripts/entity/write.mjs's field door does not apply
// and pretending it did would be theatre. But org_assets.asset_url IS served,
// and this is the exact path that produced "244 villas wearing one identical
// logo binary belonging to their rental agency": a bulk mirror that hashes
// every image and never asks whether the same hash is landing on unrelated
// subjects. It ALREADY computes that hash. So `sharedValue` — the same organ
// that measured the 244-villa cluster — is run over the full sha256 across
// every org before anything is inserted. Called unchanged from validate.mjs.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { sharedValue } from '../entity/validate.mjs';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');
const MAX_PER_ORG = Number(process.env.MAX_PER_ORG || 6);
const BUCKET = 'concierge-media';

const { data: orgs, error } = await db
  .from('organizations')
  .select('id, name, slug, metadata')
  .eq('metadata->>project', 'lofficiel-concierge')
  .not('metadata->site->facts->image_urls', 'is', null)
  .limit(2000);
if (error) throw error;

const { data: existing } = await db.from('org_assets').select('org_slug, asset_url').limit(50000);
const seen = new Set((existing || []).map((e) => `${e.org_slug}|${e.asset_url}`));

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const s = { orgs: 0, tried: 0, mirrored: 0, skipped_dupe: 0, failed: 0, too_small: 0, held_shared_binary: 0 };

// ── PASS 1: fetch and hash. NOTHING is uploaded or inserted here. ──────────
// The shared-binary defect does not exist inside one org — it exists across
// them, so it is unreachable while each org is finished before the next starts.
// That restructuring IS the fix; the download work is identical.
const staged = [];
for (const o of orgs) {
  const urls = (o.metadata?.site?.facts?.image_urls || []).slice(0, MAX_PER_ORG);
  if (!urls.length || !o.slug) continue;
  s.orgs++;
  let idx = 0;
  for (const url of urls) {
    if (seen.has(`${o.slug}|${url}`)) { s.skipped_dupe++; continue; }
    s.tried++;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeConcierge/1.0)' } });
      if (!r.ok) { s.failed++; continue; }
      const ct = (r.headers.get('content-type') || '').split(';')[0];
      if (!EXT[ct]) { s.failed++; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 12000) { s.too_small++; continue; }   // icons/spacers, not photography
      const full = crypto.createHash('sha256').update(buf).digest('hex');
      staged.push({ o, url, ct, buf, full, hash: full.slice(0, 16), idx: idx++ });
    } catch { s.failed++; }
  }
  if (s.orgs % 25 === 0) console.error(JSON.stringify(s));
}

// ── PASS 2: the cohort check, on the hash this script already computed. ────
// Keyed per (org, binary) so one org legitimately reusing its own image across
// its own pages is one row here, and only a binary crossing ORG boundaries can
// cluster. `sharedValue` decides; its `sameBusiness` arm already distinguishes
// duplicate rows for one business from a genuine misattribution, so a `flag`
// (one business, several rows) is not held.
const perOrgBinary = [...new Map(staged.map((x) => [`${x.o.id}|${x.full}`, x])).values()];
const findings = sharedValue(
  perOrgBinary.map((x) => ({ id: `${x.o.id}|${x.full}`, __name: x.o.name, __digest: x.full })),
  { field: '__digest' },
);
const heldDigests = new Set();
for (const f of findings) {
  if (f.severity === 'flag') continue;
  heldDigests.add(f.evidence.value);
  console.error(`  HELD ${f.evidence.n} orgs share one image binary [${f.severity}] ${f.reason}`);
  console.error(`       ${f.evidence.subjects.join(' · ')}`);
}

// ── PASS 3: write only what survived. ─────────────────────────────────────
for (const { o, url, ct, buf, full, hash, idx } of staged) {
  if (heldDigests.has(String(full).slice(0, 140))) {
    // Not uploaded, not inserted, not lost: the finding is reported and the
    // binary stays at its origin. Nothing was deleted — it never landed.
    s.held_shared_binary++;
    continue;
  }
  const path = `org-site/${o.id}/${hash}.${EXT[ct]}`;
  if (!APPLY) { s.mirrored++; continue; }
  try {
    const { error: up } = await db.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
    if (up) { s.failed++; continue; }
    const publicUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const { error: ie } = await db.from('org_assets').insert({
      org_slug: o.slug,
      asset_type: idx === 0 ? 'banner' : 'photo',
      asset_url: publicUrl,
      storage_path: `${BUCKET}/${path}`,
      mime_type: ct,
      file_size: buf.length,
      metadata: {
        origin_url: url,
        source: o.metadata.site.source_url,
        observed_at: o.metadata.site.observed_at,
        method: o.metadata.site.extraction_method,
        trust: o.metadata.site.trust,
        mirrored_at: new Date().toISOString(),
        sha256: full,
        shared_binary_checked: true,
      },
    });
    if (ie) { s.failed++; continue; }
    seen.add(`${o.slug}|${url}`);
    s.mirrored++;
  } catch { s.failed++; }
}
console.error('FINAL ' + JSON.stringify(s, null, 2));
