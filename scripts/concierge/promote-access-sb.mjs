// Promote already-acquired access.sb enrichment into the columns the app reads.
// This data was captured 2026-07-04 and has been sitting in metadata unused —
// which is why profiles render empty despite evidence existing.
// Gate: the page's own name must match the org, or we do not propagate it.
//
// TWO gates now, and they ask different questions. The name-corroboration gate
// below asks "is this access.sb block ABOUT this org" and stays exactly as it
// was — it is this script's own judgement and it is the cheap one. Everything
// that survives it then goes through scripts/entity/write.mjs, which asks the
// questions this script never could: is the source the org's own door, is the
// page about the right REGION, and does a value already stand in the column.
// A directory entry corroborating a name is not the same as a directory entry
// describing the right island — Saint-Barthélemy-de-Bellegarde in the Dordogne
// has restaurants with matching names too.
import { createClient } from '@supabase/supabase-js';
import { guardedOrgWrite, pageEvidence, ADMITTED } from './_guarded_org_write.mjs';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

// fold accents too: "La Crêperie" and "LA CREPERIE" are the same door
const compact = (s) => (s || '')
  .replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');
const DAY = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' };

const { data: orgs, error } = await db
  .from('organizations')
  .select('id, name, slug, description, hours_of_operation, phone, address, latitude, longitude, city, country, metadata')
  .eq('metadata->>project', 'lofficiel-concierge')
  .not('metadata->access_sb', 'is', null)
  .limit(1000);
if (error) throw error;

const s = { seen: 0, name_ok: 0, blocked: 0, desc: 0, hours: 0, wrote: 0, gate_held: 0, gate_admitted: 0 };
const blocked = [];

for (const o of orgs) {
  s.seen++;
  const a = o.metadata.access_sb;
  const f = a?.facts || {};
  const n1 = compact(o.name), n2 = compact(f.name);
  // the extracted page name must corroborate the org, else the block is about someone else
  const ok = n2 && (n1 === n2 || n1.includes(n2) || n2.includes(n1));
  if (!ok) { s.blocked++; blocked.push({ name: o.name, page_name: f.name, src: a.source_url }); continue; }
  s.name_ok++;

  // Fill-only-empty is unchanged: a candidate is only ever OFFERED for a column
  // that stands empty. What changed is that offering it is no longer the same
  // act as writing it.
  const prov = {
    source: 'access.sb',
    source_url: a.source_url,
    observed_at: a.observed_at,
    method: a.extraction_method || 'sitemap+jsonld',
    trust: 'directory_structured',
  };
  const fields = [];
  if (f.description && !o.description) {
    fields.push({ ...prov, field: 'description', value: String(f.description).replace(/\s+/g, ' ').trim() });
  }
  if (Array.isArray(f.hours) && f.hours.length && !Object.keys(o.hours_of_operation || {}).length) {
    // keep the raw strings verbatim; add a readable form without inventing any hour
    fields.push({
      ...prov,
      field: 'hours_of_operation',
      value: {
        ...prov,
        raw: f.hours,
        readable: f.hours.map((h) => {
          const m = String(h).match(/^([A-Za-z]{2})\s+(\d{2}:\d{2}):\d{2}-(\d{2}:\d{2}):\d{2}$/);
          return m ? `${DAY[m[1]] || m[1]} ${m[2]}–${m[3]}` : String(h);
        }),
      },
    });
  }
  if (!fields.length) continue;

  // The evidence is the access.sb block itself — its page text is whatever that
  // capture actually carried. Nothing is synthesised to make the gate pass: if
  // the block held no prose, the gate is told so and judges on host+path alone.
  const r = await guardedOrgWrite({
    org: o,
    fields,
    evidence: pageEvidence({
      url: a.source_url,
      text: [f.name, f.description, f.address, (f.hours || []).join(' ')].filter(Boolean).join(' \n') || null,
      address: f.address || null,
      lat: f.latitude ?? null, lng: f.longitude ?? null,
    }),
    apply: APPLY,
  });
  for (const [field, dec] of Object.entries(r.decisions)) {
    if (ADMITTED(dec)) { s.gate_admitted++; if (field === 'description') s.desc++; if (field === 'hours_of_operation') s.hours++; }
    else if (dec.action !== 'skipped') {
      s.gate_held++;
      console.error(`  HELD ${field} — ${o.name}: [${dec.action}] ${String(dec.reason).slice(0, 160)}`);
    }
  }
  if (r.admitted.length) s.wrote++;
  if (r.sidecar_error) console.error('FAIL', o.name, r.sidecar_error);
}

console.error(JSON.stringify(s, null, 2));
console.error('\nBLOCKED (page name does not corroborate the org — not propagated):');
for (const b of blocked) console.error(`  ${b.name}  <-  page says "${b.page_name}"  ${b.src}`);
