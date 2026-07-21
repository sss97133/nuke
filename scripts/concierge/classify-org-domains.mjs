// Pre-classify every remaining org by what its domain can possibly be evidence FOR.
// No fetching. The point is to never spend a crawl on a worldwide brand site that
// cannot, even in principle, describe a Gustavia door.
//
// GATE NOTE. --record-verdicts writes ONLY bookkeeping columns (metadata,
// data_signals, enrichment_*) and asserts no fact — it fetches nothing and its
// whole point is to record a REFUSAL. There is no served value to gate, so
// nothing here goes through writeField. It routes through the shared adapter
// anyway so that a gate record from any other enricher touching the same org
// is merged rather than clobbered by this metadata write, which is the one way
// this script could destroy something it never created.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { guardedOrgWrite } from './_guarded_org_write.mjs';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const decode = (s) => (s || '').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const fold = (s) => decode(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const compact = (s) => fold(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const GENERIC = /^(the|and|les|des|del|saint|st|barth|barths|barthelemy|sbh|sas|sarl|inc|ltd|llc|group|groupe|restaurant|restaurants|bar|cafe|hotel|villa|villas|boutique|shop|store|beach|club|jewelry|jewellery|bijouterie|chef|chefs|prive|events|event|architectures|architecture|architectes|design|studio|rental|rentals|real|estate|immobilier|agence|agency|services|service|company|maison|island|caraibes|france|paris|official|site|home|gustavia)$/;
const tokens = (s) => fold(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !GENERIC.test(t));

// island markers in a hostname are the strongest cheap signal that a site serves THIS island
// Worldwide houses whose .com is the global storefront. Each is a maison with
// hundreds of doors; the site describes the brand, never this island's boutique.
const GLOBAL_MAISON = new Set(['dior','bulgari','longchamp','valentino','vilebrequin','hermes','chopard','prada','rolex','louisvuitton','chanel','gucci','cartier','richardmille','chromehearts','stuartweitzman','ralphlauren','eresparis','paindesucre','hertz','avis','europcar']);

const ISLAND = /stbarth|st-barth|saintbarth|saint-barth|stbarts|st-barts|stbarthelemy|sbh|97133|stbarths/i;

const { data: orgs, error } = await db
  .from('organizations')
  .select('id, name, slug, website, description, metadata')
  .eq('metadata->>project', 'lofficiel-concierge')
  .not('website', 'is', null)
  .is('metadata->site', null)
  .limit(2000);
if (error) throw error;

// How many DISTINCT org names share a host? A host serving many differently-named
// orgs is a portal/parent, not any one org's own site.
const hostOrgs = new Map();
const hostOf = (w) => { try { return new URL(w).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
for (const o of orgs) {
  const h = hostOf(o.website); if (!h) continue;
  if (!hostOrgs.has(h)) hostOrgs.set(h, new Set());
  hostOrgs.get(h).add(compact(o.name));
}

const rows = [];
for (const o of orgs) {
  const host = hostOf(o.website);
  if (!host) { rows.push({ ...o, tier: 'T4_bad_url', reason: 'unparseable website value' }); continue; }
  const bare = host.replace(/\.(com|fr|net|org|co|sb|eu|io|shop|store)(\.[a-z]{2})?$/, '');
  const barec = compact(bare);
  const on = tokens(o.name);
  const nameInDomain = on.some((t) => barec.includes(compact(t)));
  const island = ISLAND.test(host);
  const shared = hostOrgs.get(host).size;

  let tier, reason;
  if (island && nameInDomain) { tier = 'T1_own_island_domain'; reason = 'domain carries the org name AND an island marker'; }
  else if (island) { tier = 'T1_own_island_domain'; reason = 'domain carries an island marker'; }
  else if (GLOBAL_MAISON.has(barec)) {
    // A worldwide house's own domain serves the maison, not the Gustavia door.
    // This cannot be derived from name+domain shape (coccoloba.fr is a LOCAL business
    // with the identical shape), so it is an explicit, per-name judgement.
    tier = 'T3_global_maison'; reason = 'worldwide brand site — cannot describe the island door; route to magazine/Instagram instead';
  }
  else if (nameInDomain) { tier = 'T2_name_domain'; reason = shared === 1 ? 'domain derives from the org name' : `domain derives from the org name (shared by ${shared} orgs)`; }
  else if (shared > 1) { tier = 'T4_shared_portal'; reason = `host serves ${shared} differently-named orgs — portal/parent, not an own site`; }
  else { tier = 'T4_no_name_link'; reason = 'domain has no relation to the org name — likely parent site or stale field'; }

  rows.push({ id: o.id, name: decode(o.name), slug: o.slug, website: o.website, host, tier, reason, cat: o.metadata?.category_fr || null, shared });
}

const by = {};
for (const r of rows) by[r.tier] = (by[r.tier] || 0) + 1;
console.error(JSON.stringify(by, null, 2));
console.error(`\ntotal ${rows.length}`);
fs.writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));

// A maison's worldwide .com is deliberately never crawled — but until that decision is
// RECORDED, the profile is just silently blank, which reads as "nobody looked." Absence has
// to be measured as absence. This writes the refusal itself, with its reason and the
// service that would actually close the gap. It fetches nothing and asserts no facts.
if (process.argv.includes('--record-verdicts')) {
  const APPLY = process.argv.includes('--apply');
  const targets = rows.filter((r) => r.tier === 'T3_global_maison');
  const observed_at = new Date().toISOString();
  let n = 0;
  for (const r of targets) {
    const { data: cur, error } = await db.from('organizations')
      .select('metadata, enrichment_sources, data_signals').eq('id', r.id).single();
    if (error) { console.error('READ FAIL', r.name, error.message); continue; }
    if (cur.metadata?.site) continue;                 // never clobber a real observation
    const block = {
      source_url: r.website, final_url: null, observed_at,
      extraction_method: 'domain_classification',     // no fetch — this is a judgement about the domain
      rank_tier: r.tier,
      entity_gate: { verdict: 'brand_global', reason: r.reason, mentions_stbarth: null },
      facts: null, trust: null, confidence: 1.0,
      not_fetched: true,
      dispatch: 'this domain cannot describe the island door — close via magazine footprint, Instagram connect, or field survey',
    };
    const upd = {
      metadata: { ...(cur.metadata || {}), site: block },
      enrichment_sources: [...new Set([...(cur.enrichment_sources || []), `domain_classification:${r.host}`])],
      last_enriched_at: observed_at,
      enrichment_status: 'site_held_brand_global',
      data_signals: {
        ...(cur.data_signals || {}),
        site: {
          verdict: 'brand_global', source_url: r.website, observed_at,
          method: 'domain_classification', trust: null, confidence: 1.0,
          description_basis: null, description_source_url: null,
          has: { description: false, phone: false, address: false, email: false, hours: false, socials: false, images: false },
          conflicts: null,
        },
      },
    };
    const res = await guardedOrgWrite({ org: { id: r.id, name: r.name }, fields: [], sidecar: upd, apply: APPLY });
    if (res.sidecar_error) { console.error('WRITE FAIL', r.name, res.sidecar_error); continue; }
    n++;
  }
  console.error(`\n${APPLY ? 'recorded' : 'would record'} measured-absence verdict on ${n}/${targets.length} global-maison orgs`);
}

for (const t of Object.keys(by).sort()) {
  console.error(`\n--- ${t} (sample) ---`);
  for (const r of rows.filter((x) => x.tier === t).slice(0, 8)) console.error(`  ${r.name.padEnd(34).slice(0, 34)} ${r.host}`);
}
