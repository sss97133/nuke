#!/usr/bin/env node
// Repair marks that render as NOTHING on a client profile.
//
// Why this exists: ax_mark is literally `logo_url IS NOT NULL`, so a stored image that
// composites to nothing still scores the org as having captured its mark. The profile then
// claims an authenticated brand presence and renders an empty box — the "clean-looking lie"
// THE FRAME exists to prevent. A null is honest; an invisible image is not.
//
// Two distinct defect classes, deliberately treated differently:
//   BLANK      -> every visible pixel is one tone once composited onto the paper ground
//                 (#FAFAF8). Almost always a white-on-transparent knockout variant, which
//                 renders fine on ink and vanishes on paper. This is a FALSE CLAIM: nulled
//                 and quarantined, so the org drops to the absent floor and becomes a work order.
//   LOW_RES    -> a real favicon (16x16 / 32x23) standing in for a logo. Genuinely the org's
//                 own mark, just too small to render well. NOT a lie, so NOT nulled — flagged
//                 for re-capture at a better source size.
//
// Nothing is deleted. Every nulled value is preserved verbatim with a restore path, matching
// the metadata.mark_quarantine convention already established by the capture-marks verifier.
//
// Usage: node scripts/concierge/repair-blank-marks.mjs [--apply]

import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

// Findings from scripts/../scratchpad/scan_marks.py — every one confirmed by decoding the
// stored image and compositing it onto the paper ground, not by judging the URL.
const BLANK = [
  ['SOLUTECH', '866x150 range=0 lum=255'],
  ['A3 ARCHITECTURES', '32x32 range=1 lum=254'],
  ['AU CHALET - CLINIQUE DU CHEVEU', '165x111 range=0 lum=255'],
  ['WINDWARD FINANCE SAS', '689x386 range=0 lum=255'],
  ['GUMBS CAR RENTAL', '380x48 range=0 lum=255'],
];
const LOW_RES = [
  ['ARTISTS OF SAINT BARTH', '32x23'],
  ['AGUA BENDITA SAINT BARTH', '32x23'],
  ['LUXURY ONES VILLAS ST BARTS', '16x16'],
  ['MASTER SKI  PILOU', '32x13'],
  ['ELAPIDA', '16x16'],
  ['MAURICE CAR RENTAL', '16x14'],
  ['BACCHUS NESPRESSO', '16x16'],
  ['BERKEY WATER ST BARTH', '16x16'],
];

const now = new Date().toISOString();
let nulled = 0, flagged = 0, missed = 0;

async function load(name) {
  const { data, error } = await db
    .from('organizations').select('id,name,logo_url,metadata').eq('name', name).limit(1).maybeSingle();
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

for (const [name, detail] of BLANK) {
  const org = await load(name);
  if (!org) { console.log(`  MISS  ${name} — no row`); missed++; continue; }
  if (!org.logo_url) { console.log(`  SKIP  ${name} — already null`); continue; }
  const metadata = {
    ...(org.metadata || {}),
    mark_quarantine: {
      reason: 'blank_renders_invisible',
      detail: `stored mark composites to a single tone on the paper ground (${detail}) — the profile would show an empty box while scoring ax_mark=true`,
      method: 'pillow_decode_composite_on_paper_ground',
      trust: 'measured',
      verifier: 'post-run mark scan (scan_marks.py) — all 605 stored marks decoded',
      nulled: true,
      logo_url_as_found: org.logo_url,
      observed_at: now,
      restore: `UPDATE organizations SET logo_url='${org.logo_url}' WHERE id='${org.id}';`,
    },
  };
  console.log(`  NULL  ${name.padEnd(34)} ${detail}`);
  if (APPLY) {
    const { error } = await db.from('organizations').update({ logo_url: null, metadata }).eq('id', org.id);
    if (error) throw new Error(`${name}: ${error.message}`);
  }
  nulled++;
}

for (const [name, detail] of LOW_RES) {
  const org = await load(name);
  if (!org) { console.log(`  MISS  ${name} — no row`); missed++; continue; }
  if (!org.logo_url) { console.log(`  SKIP  ${name} — already null`); continue; }
  const metadata = {
    ...(org.metadata || {}),
    mark_quality: {
      reason: 'low_resolution_favicon',
      detail: `mark is a ${detail} favicon standing in for a logo — genuinely this org's own asset, but too small to render at profile scale`,
      method: 'pillow_decode_dimension_check',
      trust: 'measured',
      nulled: false,
      needs: 'recapture at a larger source (og:image, apple-touch-icon, or the site header logo)',
      observed_at: now,
    },
  };
  console.log(`  FLAG  ${name.padEnd(34)} ${detail} (kept — real asset, low res)`);
  if (APPLY) {
    const { error } = await db.from('organizations').update({ metadata }).eq('id', org.id);
    if (error) throw new Error(`${name}: ${error.message}`);
  }
  flagged++;
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${nulled} blank marks nulled+quarantined, ${flagged} low-res marks flagged, ${missed} rows not found`);
if (!APPLY) console.log('re-run with --apply to write');
