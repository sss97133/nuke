// The sibarth villa orgs were scraped 2026-01-30 with the agency's own verbatim tagline
// and listing photos, then never surfaced. Promote both, with provenance.
// A tagline is the operator's own one-line statement — it is not a description, and it
// is stored as what it is so nothing pretends to be more than it is.
//
// The tagline goes through scripts/entity/write.mjs. The 244-villa defect (one
// agency logo worn by 244 villas) is this exact shape one column over: an
// agency's own asset propagated onto every villa it lists. A tagline lifted
// from a listing page is the agency's sentence, and whether it may stand as the
// VILLA's description is a question this script cannot answer alone.
import { createClient } from '@supabase/supabase-js';
import { guardedOrgWrite, pageEvidence, ADMITTED } from './_guarded_org_write.mjs';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

const { data: orgs, error } = await db
  .from('organizations')
  .select('id, name, slug, description, website, latitude, longitude, city, country, metadata')
  .eq('metadata->>project', 'lofficiel-concierge')
  .is('metadata->>source', null)
  .limit(2000);
if (error) throw error;

const s = { seen: 0, tagline: 0, has_images: 0, skipped_no_tagline: 0, gate_held: 0, no_observed_at: 0 };

for (const o of orgs) {
  const m = o.metadata || {};
  if (m.entity_type !== 'villa') continue;
  s.seen++;
  const tag = typeof m.tagline === 'string' ? m.tagline.replace(/\s+/g, ' ').trim() : null;
  // real listing photos only — the earlier scrape mixed google map tiles into metadata.photos
  const imgs = [...new Set([...(m.images || []), ...(m.photos || [])])]
    .filter((u) => typeof u === 'string' && !/maps\.googleapis\.com|maps\.google/.test(u));
  if (imgs.length) s.has_images++;
  if (!tag) { s.skipped_no_tagline++; continue; }

  const upd = {
    metadata: {
      ...m,
      site: {
        source_url: o.website,
        observed_at: m.scraped_at || null,
        extraction_method: 'sibarth-listing-scrape',
        trust: 'agency_listing_verbatim',
        confidence: 0.8,
        entity_gate: { verdict: 'agency_listing', reason: 'villa listed on its rental agency\'s own site' },
        facts: {
          tagline_verbatim: tag,
          bedrooms_min: m.bedrooms_min ?? null,
          bedrooms_max: m.bedrooms_max ?? null,
          price_low: m.price_low ?? null,
          price_high: m.price_high ?? null,
          price_currency: m.price_currency ?? null,
          price_period: m.price_period ?? null,
          image_urls: imgs.length ? imgs : null,
        },
      },
    },
  };
  // The tagline is offered, not written. Provenance is mandatory at the door:
  // a listing scrape with no `scraped_at` cannot say WHEN it was true, and a
  // value that cannot be dated cannot be defended. That is a refusal, and it is
  // counted rather than hidden — these rows need a re-scrape, not a shrug.
  const fields = [];
  if (!o.description && tag) {
    if (!m.scraped_at) s.no_observed_at++;
    fields.push({
      field: 'description', value: tag,
      source: 'sibarth-listing', source_url: o.website, observed_at: m.scraped_at || null,
      method: 'sibarth-listing-scrape', trust: 'agency_listing_verbatim',
    });
  }

  const r = await guardedOrgWrite({
    org: o,
    fields,
    // A listing page is the AGENCY's page. Its text is the tagline itself —
    // that is all this months-old capture preserved, and the gate is told
    // exactly that rather than being handed a richer page that no longer exists.
    evidence: pageEvidence({ url: o.website, text: [o.name, tag].filter(Boolean).join(' \n') }),
    sidecar: upd,
    apply: APPLY,
  });
  if (ADMITTED(r.decisions.description)) s.tagline++;
  else if (r.decisions.description && r.decisions.description.action !== 'skipped') {
    s.gate_held++;
    console.error(`  HELD description — ${o.name}: [${r.decisions.description.action}] ${String(r.decisions.description.reason).slice(0, 160)}`);
  }
  if (r.sidecar_error) console.error('FAIL', o.name, r.sidecar_error);
}
console.error(JSON.stringify(s, null, 2));
