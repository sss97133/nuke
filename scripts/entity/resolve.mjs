#!/usr/bin/env node
/**
 * resolve.mjs — UNIVERSAL identity resolution. One real thing, many sources, N aliases.
 *
 * Generalises scripts/resolve_canonical_villas.py (lofficiel-concierge) — which resolved
 * 1,211 agency listings to 603 physical villas and correctly REFUSED 643 ambiguous pairs —
 * from villas-only to every subject type in the platform.
 *
 * IT REPLACES NOTHING.
 *   - resolve_canonical_villas.py keeps the `property` type (a concurrent workflow owns
 *     properties/villa views; the adapter here is registered as DELEGATED and refuses to run).
 *   - scripts/concierge/flag-org-duplicates.mjs keeps sole ownership of the
 *     organizations.metadata.duplicate_candidate WRITE. This tool is plan-only and reads that
 *     key back to reconcile. Two writers on one key is how facts drift; there is one writer.
 *   - scripts/concierge/_org_entity_gate.mjs supplies the org normalisers (fold/stripLegal/
 *     tokens/GENERIC). Imported, not re-derived — every rule in it carries a measured
 *     false-positive citation.
 *
 * ---------------------------------------------------------------------------------------
 * THE LADDER (docs/library/.../03-entity-resolution.md; VILLA_TURNSTILE_INGESTION.md §3)
 *
 *   rung 1  GEO PROXIMITY   physical coincidence. Corroboration REQUIRED (never alone).
 *   rung 2  CONTENT         a shared artifact — the same photograph, the same phone line,
 *                           the same handle. Reaches sources that publish no geo.
 *   rung 3  NAME + QUALIFIER + ATTRIBUTES   candidate-grade. Never merges alone.
 *   rung 4  SOURCE-LOCAL CODES   permanent ALIASES and stable re-crawl keys WITHIN a
 *                           source. NEVER a join key ACROSS sources.
 *
 * THE FINDING THAT MADE THIS TOOL WORTH WRITING (measured 2026-07-20, --calibrate):
 * the ladder's ORDER is not universal. Rung strength is a property of the DATA SOURCE,
 * not of the rung. Villa geo is per-house and carried 855 edges. Org geo is per-TOWN:
 * 922 of 1,691 geo-bearing concierge orgs sit on 46 shared centroid pins (143 orgs on one
 * Gustavia pin), and even after suppressing those, orgs <=1 m apart are name-compatible
 * only 18% of the time. So rung 1 is DISABLED for organizations by measurement, not taste.
 * Every adapter therefore declares its rungs, and --calibrate re-derives the collision
 * table that justifies them. A threshold nobody can re-measure is a threshold nobody
 * should trust.
 *
 * UNIVERSAL SAFETY (learned from the villa run, and re-measured here):
 *   - DEGENERATE-KEY SUPPRESSION. A key value borne by more than `maxBearers` records is
 *     not an identity, it is a category. Villas: a phash on >5 listings is a logo/floorplan.
 *     Orgs: a coordinate on >3 orgs is a town centroid; sibarth.com is the `website` of 360
 *     separate villa orgs (65,087 colliding pairs, 0% name-compatible) so the registrable
 *     domain is rung 4 for orgs, not a join key. Products: a dish name on many orgs is a
 *     menu cliche, not a product.
 *   - TWIN-CONFLICT GUARD. If source B already carries a SEPARATE record whose normalised
 *     name is A's name, then B's differently-named record is not A. (Villa 'Bonnie'/'Clyde':
 *     30 m apart, all four agencies list BOTH, and they share a photo shoot. The evidence
 *     was real and the conclusion was wrong.) Universal — enabled for every type.
 *   - SIZE/QUALIFIER GUARD. A leading size or annex qualifier makes a DIFFERENT thing:
 *     'Citron Vert' vs 'Mini Citron Vert', 'Voyage' vs 'Ti Voyage'. Generalises to products
 *     ('Set of 2', 'Petit') and orgs.
 *   - AMBIGUOUS STAYS UNMERGED, with a candidate_match note and a stated reason.
 *
 * NOT PORTED, deliberately: the villa SAME-SOURCE guard ("an agency does not list one house
 * twice"). Measured false for organizations — directory-saintbarth.com ran twice on
 * 2026-01-30 with different apostrophe handling, so the SAME source emitted both BARTH'LOC
 * and BARTHLOC. Porting that guard would refuse exactly the 59 merges we want. Per-adapter.
 *
 * ---------------------------------------------------------------------------------------
 * THIS TOOL NEVER WRITES. Merging real client records is owner territory and a testimony
 * operation: it must be reversible, must record lineage, and must never delete the absorbed
 * record. It emits PROPOSALS with evidence. (agent-trust-invariants: never delete, never
 * overwrite a fact, supersede.)
 *
 * USAGE
 *   node scripts/entity/resolve.mjs <type> [flags]
 *   node scripts/entity/resolve.mjs organization
 *   node scripts/entity/resolve.mjs organization --calibrate     # re-measure the thresholds
 *   node scripts/entity/resolve.mjs product --scope=kind=dish --out=output/entity/prod.json
 *   node scripts/entity/resolve.mjs person --verbose
 *   node scripts/entity/resolve.mjs --list
 *
 *   types: organization | product | person | brand | property(delegated)
 *   flags: --calibrate  --scope=col=val  --out=PATH  --limit=N  --verbose  --list
 *
 *   Always: cd /Users/skylar/nuke && dotenvx run --quiet -- node scripts/entity/resolve.mjs ...
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fold, stripLegal, tokens as orgTokens } from '../concierge/_org_entity_gate.mjs';

const RESOLVER_VERSION = 'universal-entity-identity/2026-07-20';

// ─────────────────────────────────────────────────────────────── shared primitives

/** casefold + strip accents + collapse punctuation. The villa resolver's fold(), generalised. */
export const norm = (s) =>
  fold(String(s ?? ''))
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** normalised name with no separators at all — 'BARTH\'LOC' and 'BARTHLOC' collapse here. */
export const compactName = (s) => norm(s).replace(/\s+/g, '');

/**
 * A leading size/annex qualifier makes a DIFFERENT physical thing, not a renamed one.
 * Measured on villas 2026-07-20: plain token-containment falsely fused 'Citron Vert' with
 * 'Mini Citron Vert', 'Voyage' with 'Ti Voyage', 'Caramba' with 'Little Caramba' — each pair
 * carried SEPARATELY by two agencies, which is the proof they are two things.
 * ('ti' is Antillean creole for 'petit'.) Extended for products/retail.
 */
const SIZE_QUALIFIERS = new Set([
  'mini', 'ti', 'little', 'petit', 'petite', 'small', 'grand', 'grande', 'gran', 'big',
  'upper', 'lower', 'annex', 'annexe', 'cottage', 'studio', 'suite', 'apartment', 'apt',
  'casita', 'junior', 'guest', 'pool', 'beach', 'house', 'north', 'south', 'east', 'west',
  'i', 'ii', 'iii', 'a', 'b', 'c', '1', '2', '3',
  // product/retail additions — a size or a pack count is a different SKU, not a rename
  'xs', 's', 'm', 'l', 'xl', 'xxl', 'set', 'pack', 'duo', 'trio', 'large', 'medium',
  'kids', 'child', 'baby', 'demi', 'half', 'double', 'single', 'refill', 'travel',
]);

const STOPWORDS = /\b(the|le|la|les|de|du|des|of|and|et|a|an)\b/g;

const nameTokens = (s) =>
  new Set(norm(s).replace(STOPWORDS, ' ').split(/\s+/).filter((t) => t.length > 1));

/**
 * Exact / whole-token-containment / token-Jaccard. NEVER used alone to merge — only ever as
 * corroboration for a physical rung, or as a rung-3 candidate.
 * Returns a label describing HOW they matched, or null.
 */
/**
 * VARIANT-SUFFIX GUARD (universal). Two names sharing a prefix before a separator and
 * differing after it are VARIANTS of one another, not two names for one thing.
 * Measured 2026-07-20: "Poncho Nava - Brick Japonism" vs "Poncho Nava - Pink Japonism",
 * "Baja Stripe Cashmere Poncho - Black Stripe" vs "- Natural Stripe", "Romance – 08" vs
 * "Romance – 09". These are separate SKUs and separate artworks, and they dominated the
 * rung-3 candidate list (25,173 pairs) until this guard landed.
 */
const SEP = /\s+[-–—|:]\s+/;
function variantSuffix(a, b) {
  const pa = norm(a).split(SEP.source ? new RegExp(SEP.source) : SEP);
  const pb = norm(b).split(new RegExp(SEP.source));
  if (pa.length < 2 || pb.length < 2) return null;
  if (pa[0] !== pb[0]) return null;
  const sa = pa.slice(1).join(' ');
  const sb = pb.slice(1).join(' ');
  return sa && sb && sa !== sb ? { shared_prefix: pa[0], a_suffix: sa, b_suffix: sb } : null;
}

export function nameCompatible(a, b, { jaccardFloor = 0.5, tokenFn = nameTokens } = {}) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return null;
  if (na === nb) return 'exact';
  if (variantSuffix(a, b)) return null;
  // sources disagree about word breaks and apostrophes: 'Coco Loco'/'Cocoloco' (6.2 m apart,
  // one house), "BARTH'LOC"/'BARTHLOC' (same phone, same directory, two ingest passes).
  if (compactName(a) === compactName(b)) return 'exact_compact';
  const ta = tokenFn(a);
  const tb = tokenFn(b);
  if (!ta.size || !tb.size) return null;
  const inter = [...ta].filter((t) => tb.has(t));
  const sub = ta.size <= tb.size ? ta : tb;
  // Containment on a ONE-token subset is not containment, it is "shares a word".
  // Measured 2026-07-20 on organizations: single-token containment produced
  // "LE SALON" vs "BG HAIR SALON", "KAZ A JUICE" vs "Villa Kaz", "AMIS ST. BARTH
  // RESTAURANT" vs "Villa Des Amis" — 278 candidate pairs of pure noise that
  // would bury the real ones. A rename keeps at least two words.
  if (inter.length === sub.size && sub.size >= 2) {
    // containment is a rename ONLY if the extra words are not a size/annex qualifier
    const extra = [...(ta.size <= tb.size ? tb : ta)].filter((t) => !sub.has(t));
    if (extra.some((t) => SIZE_QUALIFIERS.has(t))) return null;
    return 'containment';
  }
  const j = inter.length / new Set([...ta, ...tb]).size;
  return j >= jaccardFloor ? `jaccard:${j.toFixed(2)}` : null;
}

const metres = (a, b) => {
  const R = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * R) / 2) ** 2 +
    Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin(((b[1] - a[1]) * R) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
};

class UF {
  constructor(n) { this.p = [...Array(n).keys()]; }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(i, j) { const a = this.find(i), b = this.find(j); if (a === b) return false; this.p[a] = b; return true; }
}

// ─────────────────────────────────────────────────────────────── transport

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * PostgREST hard-caps at 1000 rows and SILENTLY CLAMPS a larger limit — read 1000 and you
 * will believe it is all of them. Paginate on a stable order. Exactly 1000 = you hit the cap.
 */
async function pagedAll(table, select, tune = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tune(db.from(table).select(select)).order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── adapters
//
// An adapter turns a table into the engine's uniform record shape and declares WHICH RUNGS
// its data can actually carry. `enabled:false` on a rung must cite the measurement.
//
//   record = { idx, id, name, source, lat, lon, attrs{}, content:{channel:[keys]}, codes{}, raw }

const registrableDomain = (u) => {
  if (!u) return null;
  try {
    const h = new URL(String(u).startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '');
    const p = h.split('.');
    return p.length > 2 && p.at(-2).length <= 3 ? p.slice(-3).join('.') : p.slice(-2).join('.');
  } catch { return null; }
};

/** last 9 digits — the shape that survives +590 / 0590 / 00590 prefixes. */
const phoneKeys = (p) => {
  const out = new Set();
  for (const chunk of String(p ?? '').split(/[/,;]|\bou\b/i)) {
    const d = chunk.replace(/\D/g, '');
    if (d.length >= 9) out.add(d.slice(-9));
  }
  return [...out];
};

const ADAPTERS = {
  organization: {
    type: 'organization',
    table: 'organizations',
    describe: 'St Barth concierge orgs + nuke shops. 59 known apostrophe-artifact pairs.',
    select: 'id,name,business_name,phone,website,latitude,longitude,city,address,metadata,discovered_via,source,created_at,slug',
    defaultScope: { path: 'metadata->>project', value: 'lofficiel-concierge' },
    load: (rows) => rows.map((r) => ({
      id: r.id,
      name: r.name || r.business_name || '',
      source: r.metadata?.source || r.discovered_via || r.source || 'unknown',
      lat: r.latitude == null ? null : Number(r.latitude),
      lon: r.longitude == null ? null : Number(r.longitude),
      attrs: { city: norm(r.city) || null, subcategory: r.metadata?.subcategory_slug ?? null },
      content: { phone: phoneKeys(r.phone) },
      codes: { registrable_domain: registrableDomain(r.website), slug: r.slug, website: r.website },
      raw: r,
    })),
    // token filter comes from the org gate: it already drops trade words ("restaurant",
    // "villa", "gustavia") that identify a CATEGORY, never a business.
    tokenFn: (s) => new Set(orgTokens(stripLegal(s || ''))),
    rungs: {
      geo: {
        enabled: false,
        radiusM: 50,
        reason:
          'MEASURED 2026-07-20: org coordinates are TOWN CENTROIDS, not addresses. 922 of 1,691 ' +
          'geo-bearing concierge orgs sit on 46 shared pins (143 on one Gustavia pin). After ' +
          'suppressing pins, orgs <=1 m apart are name-compatible only 18% of the time (98 pairs). ' +
          'Geo here is a quartier signal. Re-enable only if per-address geocoding lands ' +
          '(cf. scripts/concierge/regeocode-centroid-pins.mjs).',
      },
      content: {
        enabled: true,
        channels: {
          // 226 colliding pairs, 36% name-compatible, 72 name-exact. A shared line is a
          // shared switchboard as often as a shared identity: "MEROU Patrick"/"BARRAUX
          // Océane"/"DOMINICI JEAN" all sit on 590278728; "DECK CLEAN"/"ZEN POOL" share
          // 690553699. So phone CORROBORATES, it never merges alone.
          phone: { minShared: 1, standsAlone: false, maxBearers: 4 },
        },
      },
      name: { enabled: true, jaccardFloor: 0.5 },
      // rung 4 — aliases only. The registrable domain lives HERE and not in the join keys:
      // 65,087 pairs share a domain at 0% name-compatibility because sibarth.com is the
      // `website` of 360 separate villa orgs. A portal domain is a landlord, not an identity.
      codes: ['registrable_domain', 'slug'],
    },
    // FALSE for orgs: directory-saintbarth.com ran twice on 2026-01-30 with different
    // apostrophe handling, so the same source legitimately emitted both spellings.
    sameSourceGuard: false,
    // rung-3-only pairs may be PROPOSED as merges when a second independent signal agrees
    // (phone, domain, or city). Still never executed.
    promoteNameWithCorroboration: true,
    priorArt: {
      table: 'organizations',
      key: 'metadata.duplicate_candidate',
      writer: 'scripts/concierge/flag-org-duplicates.mjs',
      read: (r) => r.metadata?.duplicate_candidate ?? null,
    },
  },

  product: {
    type: 'product',
    table: 'concierge_products',
    describe: 'concierge_products — the same item across catalogs (printed guestbook vs merchant site).',
    select: 'id,org_id,name,kind,price,currency,source,provenance,media,is_superseded,status,created_at',
    load: (rows) => rows.map((r) => ({
      id: r.id,
      name: r.name || '',
      source: r.source || 'unknown',
      lat: null,
      lon: null,
      // org_id is the QUALIFIER: two restaurants both serving "Légumes Grillés" is a menu
      // cliche, not one product. Measured: 114 cross-org name-identical pairs.
      attrs: { org_id: r.org_id, kind: r.kind },
      content: {
        media: (Array.isArray(r.media) ? r.media : [])
          .map((m) => (typeof m === 'string' ? m : m?.url || m?.src))
          .filter(Boolean),
      },
      codes: {
        source_page: r.provenance?.page != null ? `${r.provenance?.publication}#${r.provenance.page}` : null,
        publication: r.provenance?.publication ?? null,
      },
      raw: r,
    })),
    rungs: {
      geo: { enabled: false, reason: 'products carry no coordinates of their own; the org\'s geo is the org\'s fact, not the product\'s.' },
      content: {
        enabled: true,
        channels: {
          // A shared image URL is a shared artifact — the strongest key that reaches a
          // catalog with no price and no page number.
          media: { minShared: 1, standsAlone: true, maxBearers: 5 },
        },
      },
      name: { enabled: true, jaccardFloor: 0.6 },
      codes: ['source_page', 'publication'],
    },
    // TRUE for products: one catalog does not list one product twice under two names.
    sameSourceGuard: true,
    promoteNameWithCorroboration: true,
    // HARD discriminators — records disagreeing on these can never be one entity.
    mustAgree: ['org_id'],
  },

  person: {
    type: 'person',
    table: 'mag_people',
    describe: 'Magazine contributors. Names vary across issues; the PK is name_canon TEXT.',
    select: 'name_canon,display_name,instagram,handles,roles,source,updated_at',
    pk: 'name_canon',
    orderBy: 'name_canon',
    load: (rows) => rows.map((r) => ({
      id: r.name_canon,
      name: r.display_name || r.name_canon || '',
      source: r.source?.publisher || r.source?.slug || 'unknown',
      lat: null,
      lon: null,
      attrs: {},
      content: {
        // A social handle is a globally-unique registered identifier — the person analogue
        // of a VIN. It stands alone.
        handle: [
          ...(r.instagram ? [String(r.instagram).replace(/^@/, '').toLowerCase()] : []),
          ...(Array.isArray(r.handles) ? r.handles.map((h) => String(h).replace(/^@/, '').toLowerCase()) : []),
        ],
      },
      codes: { name_canon: r.name_canon },
      raw: r,
    })),
    rungs: {
      geo: { enabled: false, reason: 'people are not places.' },
      content: { enabled: true, channels: { handle: { minShared: 1, standsAlone: true, maxBearers: 2 } } },
      name: { enabled: true, jaccardFloor: 0.66 },
      codes: ['name_canon'],
    },
    sameSourceGuard: false,
    promoteNameWithCorroboration: false, // no independent second signal exists for most rows
    // A person name is not a villa name: 'Jean Dupont' vs 'Jean-Marc Dupont' is two people.
    // Containment on human names is unsafe, so demand a higher Jaccard and no containment.
    forbidContainment: true,
  },

  brand: {
    type: 'brand',
    table: 'brands',
    describe: 'brands (89, uuid PK) RECONCILED AGAINST organization_brands.brand_name (136, TEXT). Two registries, never joined — that is the unsolved problem.',
    select: 'id,name,slug,created_at',
    /**
     * Brand identity is split across two registries that have never been joined:
     *   brands              — 89 rows, uuid PK, slug. The marque registry.
     *   organization_brands — 136 rows, brand_name TEXT. What a dealer/boutique CARRIES.
     * A single-table run finds nothing (a curated registry has no internal duplicates), so
     * resolving brands means resolving ACROSS the two — which is exactly the cross-source
     * problem the ladder is for. Proposals here are LINK proposals (brand_name -> brands.id),
     * never merges: minting brands.id values from free text is an owner decision.
     */
    loadCustom: async () => {
      const a = await pagedAll('brands', 'id,name,slug,created_at');
      const b = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('organization_brands')
          .select('id,brand_name,authorization_level,organization_id,source_url,operating_name')
          .order('id').range(from, from + 999);
        if (error) throw new Error(`organization_brands: ${error.message}`);
        b.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
      }
      return [
        ...a.map((r) => ({ __registry: 'brands', ...r })),
        ...b.map((r) => ({ __registry: 'organization_brands', ...r })),
      ];
    },
    load: (rows) => rows.map((r) => r.__registry === 'brands'
      ? { id: r.id, name: r.name || r.slug || '', source: 'brands', lat: null, lon: null,
          attrs: {}, content: {}, codes: { slug: r.slug }, raw: r }
      : { id: r.id, name: r.brand_name || r.operating_name || '', source: 'organization_brands',
          lat: null, lon: null,
          attrs: { authorization_level: r.authorization_level ?? null },
          content: {},
          codes: { slug: norm(r.brand_name).replace(/\s+/g, '-') || null, source_url: r.source_url },
          raw: r }),
    rungs: {
      geo: { enabled: false, reason: 'brands are not places.' },
      content: { enabled: false, reason: 'no shared-artifact channel exists on brands yet (no logo phash, no canonical asset).' },
      name: { enabled: true, jaccardFloor: 0.7 },
      codes: ['slug'],
    },
    // TRUE: one registry does not hold one brand twice under two names — within `brands`
    // that would be a registry bug, and within organization_brands the (org, brand_name)
    // pair is unique. So an intra-registry name clash is a signal, not a merge.
    sameSourceGuard: true,
    // exact brand-name equality + an agreeing slug is the link proposal
    promoteNameWithCorroboration: true,
  },

  property: {
    type: 'property',
    delegated: {
      to: 'lofficiel-concierge/scripts/resolve_canonical_villas.py',
      why:
        'Villas are ALREADY resolved by a working, measured, purpose-built resolver: 1,211 ' +
        'listings -> 603 physical villas, 855 edges, 643 ambiguous pairs correctly refused. It ' +
        'carries villa-specific evidence this engine does not have (gallery phash staging, ' +
        'WIMCO WV-code harvesting from filenames, quartier alias table, paired-villa guard ' +
        'tuned on Bonnie/Clyde). Re-running a weaker generic ladder over the same table would ' +
        'be a second opinion with less evidence. A concurrent workflow also owns properties ' +
        'and the villa views right now.',
      run: 'cd /Users/skylar/lofficiel-concierge && python3 scripts/resolve_canonical_villas.py plan',
    },
  },
};

// ─────────────────────────────────────────────────────────────── the engine

/** A key value borne by more than maxBearers records is a CATEGORY, not an identity. */
function suppressDegenerate(records, channel, maxBearers) {
  const bearers = new Map();
  for (const r of records) for (const k of r.content?.[channel] ?? []) {
    if (!bearers.has(k)) bearers.set(k, new Set());
    bearers.get(k).add(r.idx);
  }
  const degenerate = new Map();
  for (const [k, s] of bearers) if (s.size > maxBearers) degenerate.set(k, s.size);
  return degenerate;
}

function rungGeo(records, cfg, nameOpts) {
  if (!cfg?.enabled) return { edges: [], candidates: [], suppressed: 0 };
  const R = cfg.radiusM ?? 50;
  const RX = cfg.radiusExactNameM ?? R;
  const pts = records.filter((r) => r.lat != null && r.lon != null);

  // degenerate-coordinate suppression — the geo analogue of a generic phash
  const pinCount = new Map();
  for (const r of pts) {
    const k = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
    pinCount.set(k, (pinCount.get(k) ?? 0) + 1);
  }
  const maxB = cfg.maxBearers ?? 3;
  const pins = new Set([...pinCount].filter(([, n]) => n > maxB).map(([k]) => k));
  const usable = pts.filter((r) => !pins.has(`${r.lat.toFixed(5)},${r.lon.toFixed(5)}`));

  const CELL = Math.max(RX, R) / 111000 * 1.2;
  const buckets = new Map();
  for (const r of usable) {
    const k = `${Math.round(r.lat / CELL)}:${Math.round(r.lon / CELL)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)).push(r);
  }
  const edges = [], candidates = [], seen = new Set();
  for (const r of usable) {
    const bx = Math.round(r.lat / CELL), by = Math.round(r.lon / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const o of buckets.get(`${bx + dx}:${by + dy}`) ?? []) {
        if (o.idx <= r.idx) continue;
        const pk = `${r.idx}:${o.idx}`;
        if (seen.has(pk)) continue;
        seen.add(pk);
        const d = metres([r.lat, r.lon], [o.lat, o.lon]);
        const nm = nameCompatible(r.name, o.name, nameOpts);
        const exact = nm === 'exact' || nm === 'exact_compact';
        const limit = exact ? RX : R;
        if (d > limit) continue;
        const ev = { rung: 1, rung_name: 'geo', distance_m: +d.toFixed(1), name_match: nm,
          geo_band: exact && d > R ? 'extended' : 'standard' };
        if (nm) edges.push([r.idx, o.idx, ev]);
        else if (d <= R) candidates.push([r.idx, o.idx, { ...ev, reason: 'geo_close_names_disagree' }]);
      }
    }
  }
  return { edges, candidates, suppressed: pins.size, suppressedRows: pts.length - usable.length };
}

function rungContent(records, cfg) {
  const out = { edges: [], candidates: [], degenerate: {} };
  if (!cfg?.enabled) return out;
  for (const [channel, ch] of Object.entries(cfg.channels ?? {})) {
    const degenerate = suppressDegenerate(records, channel, ch.maxBearers ?? 5);
    out.degenerate[channel] = [...degenerate].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const byKey = new Map();
    for (const r of records) for (const k of r.content?.[channel] ?? []) {
      if (degenerate.has(k)) continue;
      (byKey.get(k) ?? byKey.set(k, []).get(k)).push(r.idx);
    }
    const hits = new Map();
    for (const [k, idxs] of byKey) {
      if (idxs.length < 2) continue;
      for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
        const key = idxs[i] < idxs[j] ? `${idxs[i]}:${idxs[j]}` : `${idxs[j]}:${idxs[i]}`;
        (hits.get(key) ?? hits.set(key, []).get(key)).push(k);
      }
    }
    for (const [key, keys] of hits) {
      const [i, j] = key.split(':').map(Number);
      const ev = { rung: 2, rung_name: `content:${channel}`, channel, shared: keys.length,
        shared_keys: keys.slice(0, 4), stands_alone: !!ch.standsAlone };
      if (keys.length >= (ch.minShared ?? 1) && ch.standsAlone) out.edges.push([i, j, ev]);
      else out.candidates.push([i, j, { ...ev, reason: ch.standsAlone
        ? `content_below_threshold (${keys.length}/${ch.minShared ?? 1} shared ${channel})`
        : `content_requires_corroboration — a shared ${channel} is as often a shared channel as a shared identity` }]);
    }
  }
  return out;
}

function rungName(records, cfg, nameOpts, mustAgree = []) {
  if (!cfg?.enabled) return [];
  const buckets = new Map();
  for (const r of records) {
    const k = compactName(r.name);
    if (!k) continue;
    (buckets.get(k) ?? buckets.set(k, []).get(k)).push(r.idx);
  }
  const out = [];
  const push = (i, j, how) => {
    const a = records[i], b = records[j];
    for (const f of mustAgree) {
      if (a.attrs[f] != null && b.attrs[f] != null && a.attrs[f] !== b.attrs[f]) return;
    }
    const agreed = ['name'];
    for (const [k, v] of Object.entries(a.attrs)) {
      if (v != null && b.attrs[k] != null && v === b.attrs[k]) agreed.push(k);
    }
    out.push([i, j, { rung: 3, rung_name: 'name+attrs', name_match: how, agreed_on: agreed }]);
  };
  // exact compact-name collisions
  for (const idxs of buckets.values()) {
    if (idxs.length < 2) continue;
    for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) push(idxs[i], idxs[j], 'exact_compact');
  }
  // fuzzy: blocked on a shared rare token so this stays O(n·k), not O(n²)
  const byTok = new Map();
  for (const r of records) for (const t of (nameOpts.tokenFn ?? nameTokens)(r.name)) {
    (byTok.get(t) ?? byTok.set(t, []).get(t)).push(r.idx);
  }
  const seen = new Set();
  for (const [, idxs] of byTok) {
    if (idxs.length < 2 || idxs.length > 60) continue; // >60 bearers = a category token
    for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
      const a = Math.min(idxs[i], idxs[j]), b = Math.max(idxs[i], idxs[j]);
      const key = `${a}:${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (compactName(records[a].name) === compactName(records[b].name)) continue; // already emitted
      const how = nameCompatible(records[a].name, records[b].name, nameOpts);
      if (!how) continue;
      if (nameOpts.forbidContainment && how === 'containment') continue;
      push(a, b, how);
    }
  }
  return out;
}

/**
 * TWIN-CONFLICT GUARD (universal). Refuse edge (i,j) when source(j) ALREADY carries a
 * separate record whose normalised name is i's. If Eden Rock lists both 'Bonnie' and
 * 'Clyde', Eden Rock's 'Clyde' is not Le Barth's 'Bonnie' — Eden Rock's 'Bonnie' is.
 * The contradiction is proof, not a heuristic.
 */
function twinConflict(records, roster, i, j) {
  const a = records[i], b = records[j];
  if (compactName(a.name) === compactName(b.name)) return null;
  for (const [x, y] of [[a, b], [b, a]]) {
    const twins = [...(roster.get(y.source)?.get(compactName(x.name)) ?? [])].filter((t) => t !== y.idx);
    if (twins.length) {
      const t = records[twins[0]];
      return { source: y.source, twin_name: t.name, twin_id: t.id };
    }
  }
  return null;
}

function resolve(records, adapter) {
  records.forEach((r, i) => { r.idx = i; });
  const nameOpts = {
    jaccardFloor: adapter.rungs.name?.jaccardFloor ?? 0.5,
    tokenFn: adapter.tokenFn ?? nameTokens,
    forbidContainment: !!adapter.forbidContainment,
  };
  const mustAgree = adapter.mustAgree ?? [];

  const g = rungGeo(records, adapter.rungs.geo, nameOpts);
  const c = rungContent(records, adapter.rungs.content);
  const n = rungName(records, adapter.rungs.name, nameOpts, mustAgree);

  const merge = new Map();
  const candidates = [];
  const put = (i, j, ev) => {
    const k = `${Math.min(i, j)}:${Math.max(i, j)}`;
    if (merge.has(k)) merge.get(k)[`also_rung${ev.rung}`] = ev; else merge.set(k, ev);
  };

  for (const [i, j, ev] of g.edges) put(i, j, ev);
  for (const [i, j, ev] of g.candidates) candidates.push([i, j, ev]);
  for (const [i, j, ev] of c.edges) put(i, j, ev);
  for (const [i, j, ev] of c.candidates) candidates.push([i, j, ev]);

  // rung 3 is candidate-grade by law. It is PROMOTED to a merge PROPOSAL only when an
  // independent signal agrees (a content channel already saw the pair, or a rung-4 code
  // matches, or a qualifier attribute agrees). Name similarity alone never merges.
  const contentPairs = new Set([...c.edges, ...c.candidates].map(([i, j]) => `${Math.min(i, j)}:${Math.max(i, j)}`));
  for (const [i, j, ev] of n) {
    const k = `${Math.min(i, j)}:${Math.max(i, j)}`;
    if (merge.has(k)) { merge.get(k).also_rung3 = ev; continue; }
    const corroborators = [];
    if (contentPairs.has(k)) corroborators.push('content_channel');
    for (const code of adapter.rungs.codes ?? []) {
      const va = records[i].codes?.[code], vb = records[j].codes?.[code];
      if (va && vb && va === vb) corroborators.push(`code:${code}`);
    }
    // ATTRIBUTES NEVER CORROBORATE. An attribute is a property of how a record is
    // CLASSIFIED (org_id, kind, city, subcategory); corroboration must be an independent
    // artifact in the WORLD (a shared photograph, a shared phone line, a shared code).
    // Measured 2026-07-20: counting attribute agreement as evidence fused 118 separate
    // "Royal Chain" rows — same org_id, same kind, same name — into one product. They are
    // 118 SKUs. `kind` agreeing is worth nothing when 21,495 of 23,731 rows are
    // 'retail_item'; that is the degenerate-key problem wearing a different hat.
    // Attributes still appear in `agreed_on` for the reader, and `mustAgree` still gates.
    const attrsAgreed = ev.agreed_on.filter((f) => f !== 'name');
    const exactName = ev.name_match === 'exact' || ev.name_match === 'exact_compact';
    if (adapter.promoteNameWithCorroboration && exactName && corroborators.length) {
      put(i, j, { ...ev, promoted: true, corroborated_by: [...new Set(corroborators)] });
    } else {
      candidates.push([i, j, { ...ev, corroborated_by: [...new Set(corroborators)], attrs_agreed: attrsAgreed,
        reason: exactName
          ? 'name_exact_but_uncorroborated — no independent signal agrees; merging on name similarity alone is forbidden'
          : 'rung3_only — names are similar but no physical or content signal agrees' }]);
    }
  }

  // roster for the twin guard
  const roster = new Map();
  for (const r of records) {
    if (!roster.has(r.source)) roster.set(r.source, new Map());
    const m = roster.get(r.source);
    const k = compactName(r.name);
    (m.get(k) ?? m.set(k, new Set()).get(k)).add(r.idx);
  }

  const refusals = [];
  for (const [k, ev] of [...merge]) {
    const [i, j] = k.split(':').map(Number);
    const tc = twinConflict(records, roster, i, j);
    if (tc) {
      merge.delete(k);
      refusals.push([i, j, { ...ev, merge_refused: true, twin_conflict: tc,
        reason: `twin_conflict — ${tc.source} separately carries "${tc.twin_name}", so these are two neighbouring things sharing evidence, not one thing under two names` }]);
      continue;
    }
    for (const f of mustAgree) {
      const va = records[i].attrs[f], vb = records[j].attrs[f];
      if (va != null && vb != null && va !== vb) {
        merge.delete(k);
        refusals.push([i, j, { ...ev, merge_refused: true,
          reason: `discriminator_disagrees — ${f}: ${va} vs ${vb}` }]);
        break;
      }
    }
  }

  // union strongest-first
  const strength = ([, ev]) => {
    if (ev.rung === 1) return (ev.name_match === 'exact' ? 1000 : 700) - (ev.geo_band === 'extended' ? 100 : 0) + Math.max(0, 60 - (ev.distance_m ?? 0));
    if (ev.rung === 2) return 800 + Math.min(ev.shared ?? 0, 60);
    return 500 + (ev.corroborated_by?.length ?? 0) * 10;
  };
  const uf = new UF(records.length);
  const comp = new Map(records.map((r, i) => [i, new Map([[r.source, new Set([compactName(r.name)])]])]));
  for (const [k, ev] of [...merge].sort((a, b) => strength(b) - strength(a))) {
    const [i, j] = k.split(':').map(Number);
    const ri = uf.find(i), rj = uf.find(j);
    if (ri === rj) continue;
    if (adapter.sameSourceGuard) {
      const a = comp.get(ri), b = comp.get(rj);
      const clash = [...a.keys()].filter((s) => b.has(s) && new Set([...a.get(s), ...b.get(s)]).size > 1);
      if (clash.length) {
        merge.delete(k);
        refusals.push([i, j, { ...ev, merge_refused: true, clashing_source: clash,
          reason: 'same_source_conflict — merging would put two differently-named records from the same source into one entity; that source does not list one thing twice' }]);
        continue;
      }
    }
    uf.union(i, j);
    const root = uf.find(i), a = comp.get(ri), b = comp.get(rj), merged = new Map();
    for (const src of [a, b]) for (const [s, ns] of src) merged.set(s, new Set([...(merged.get(s) ?? []), ...ns]));
    comp.set(root, merged);
  }

  const groups = new Map();
  for (let i = 0; i < records.length; i++) (groups.get(uf.find(i)) ?? groups.set(uf.find(i), []).get(uf.find(i))).push(i);

  const richness = (r) => (r.lat != null ? 4 : 0) + Object.values(r.attrs).filter((v) => v != null).length
    + Object.values(r.content).flat().length / 5 + Object.values(r.codes).filter(Boolean).length;

  const clusters = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const ms = [...members].sort((a, b) => richness(records[b]) - richness(records[a]));
    const edges = [...merge].filter(([k]) => uf.find(Number(k.split(':')[0])) === root)
      .map(([k, ev]) => { const [i, j] = k.split(':').map(Number);
        return { a: records[i].id, b: records[j].id, a_name: records[i].name, b_name: records[j].name,
          a_source: records[i].source, b_source: records[j].source, ...ev }; });
    clusters.push({
      cluster_id: records[ms[0]].id,
      canonical_id: records[ms[0]].id,
      canonical_name: records[ms[0]].name,
      canonical_source: records[ms[0]].source,
      n_members: ms.length,
      sources: [...new Set(ms.map((i) => records[i].source))].sort(),
      rungs_used: [...new Set(edges.map((e) => e.rung))].sort(),
      members: ms.map((i) => ({ id: records[i].id, name: records[i].name, source: records[i].source,
        aliases: records[i].codes, attrs: records[i].attrs })),
      edges,
    });
  }
  clusters.sort((a, b) => b.n_members - a.n_members || String(a.canonical_name).localeCompare(String(b.canonical_name)));

  const out = (list) => list.filter(([i, j]) => uf.find(i) !== uf.find(j)).map(([i, j, ev]) => ({
    a: records[i].id, b: records[j].id, a_name: records[i].name, b_name: records[j].name,
    a_source: records[i].source, b_source: records[j].source, ...ev }));

  return { clusters, candidates: out(candidates), refusals: out(refusals), geoStats: g, contentStats: c };
}

// ─────────────────────────────────────────────────────────────── calibration

/**
 * Re-derive the collision table that justifies every threshold in the adapter.
 * A threshold nobody can re-measure is a threshold nobody should trust.
 */
function calibrate(records, adapter) {
  const nameOpts = { jaccardFloor: adapter.rungs.name?.jaccardFloor ?? 0.5, tokenFn: adapter.tokenFn ?? nameTokens };
  const line = (label, pairs, compat, exact, examples) => {
    console.log(`  ${label.padEnd(34)} ${String(pairs).padStart(7)} pairs | name-compatible ${String(compat).padStart(6)} (${((100 * compat) / (pairs || 1)).toFixed(0).padStart(3)}%) | exact ${exact}`);
    for (const e of examples.slice(0, 3)) console.log(`      counter-example: ${e}`);
  };
  console.log('\nCALIBRATION — collision rate per candidate key (measured now, on live data)');
  console.log(`  records: ${records.length}\n`);

  for (const [channel] of Object.entries(adapter.rungs.content?.channels ?? {})) {
    const byKey = new Map();
    for (const r of records) for (const k of r.content?.[channel] ?? []) (byKey.get(k) ?? byKey.set(k, []).get(k)).push(r);
    let pairs = 0, compat = 0, exact = 0; const ex = [];
    for (const rows of byKey.values()) { if (rows.length < 2) continue;
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) { pairs++;
        const c = nameCompatible(rows[i].name, rows[j].name, nameOpts);
        if (c) { compat++; if (c.startsWith('exact')) exact++; } else if (ex.length < 3) ex.push(`"${rows[i].name}" vs "${rows[j].name}"`); } }
    line(`content:${channel}`, pairs, compat, exact, ex);
  }
  for (const code of adapter.rungs.codes ?? []) {
    const byKey = new Map();
    for (const r of records) { const v = r.codes?.[code]; if (v) (byKey.get(v) ?? byKey.set(v, []).get(v)).push(r); }
    let pairs = 0, compat = 0, exact = 0; const ex = [];
    for (const rows of byKey.values()) { if (rows.length < 2) continue;
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) { pairs++;
        const c = nameCompatible(rows[i].name, rows[j].name, nameOpts);
        if (c) { compat++; if (c.startsWith('exact')) exact++; } else if (ex.length < 3) ex.push(`${rows[i].codes[code]} :: "${rows[i].name}" vs "${rows[j].name}"`); } }
    line(`code:${code} (rung 4, alias only)`, pairs, compat, exact, ex);
  }
  const pts = records.filter((r) => r.lat != null);
  if (pts.length) {
    const pin = new Map();
    for (const r of pts) { const k = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`; pin.set(k, (pin.get(k) ?? 0) + 1); }
    const shared = [...pin].filter(([, n]) => n > 3);
    console.log(`\n  geo: ${pts.length} geo-bearing records; ${shared.length} coordinates shared by >3 records, covering ${shared.reduce((s, [, n]) => s + n, 0)} records`);
    for (const [k, n] of shared.sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`      centroid pin ${k} -> ${n} records`);
    const bands = { 1: [0, 0], 5: [0, 0], 10: [0, 0], 25: [0, 0], 50: [0, 0] };
    const pinned = new Set(shared.map(([k]) => k));
    const usable = pts.filter((r) => !pinned.has(`${r.lat.toFixed(5)},${r.lon.toFixed(5)}`));
    for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) {
      const d = metres([usable[i].lat, usable[i].lon], [usable[j].lat, usable[j].lon]);
      if (d > 50) continue;
      const c = !!nameCompatible(usable[i].name, usable[j].name, nameOpts);
      for (const b of [1, 5, 10, 25, 50]) if (d <= b) { bands[b][0]++; if (c) bands[b][1]++; break; }
    }
    console.log(`  geo excluding centroid pins: ${usable.length} records`);
    for (const b of [1, 5, 10, 25, 50]) console.log(`      <=${String(b).padStart(2)}m: ${String(bands[b][0]).padStart(5)} pairs, name-compatible ${bands[b][1]} (${((100 * bands[b][1]) / (bands[b][0] || 1)).toFixed(0)}%)`);
  }
  console.log('\n  Adapter rung decisions:');
  for (const [rung, cfg] of Object.entries(adapter.rungs)) {
    if (rung === 'codes') continue;
    console.log(`      ${rung.padEnd(9)} ${cfg.enabled ? 'ENABLED' : 'DISABLED'}${cfg.reason ? ` — ${cfg.reason}` : ''}`);
  }
}

// ─────────────────────────────────────────────────────────────── cli

const argv = process.argv.slice(2);
const flag = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const has = (n) => argv.includes(`--${n}`);
const type = argv.find((a) => !a.startsWith('--'));

if (has('list') || !type) {
  console.log(`\nresolve.mjs ${RESOLVER_VERSION}\n\nSUBJECT TYPES:`);
  for (const [k, a] of Object.entries(ADAPTERS)) {
    if (a.delegated) { console.log(`  ${k.padEnd(14)} DELEGATED -> ${a.delegated.to}`); continue; }
    console.log(`  ${k.padEnd(14)} ${a.table.padEnd(20)} ${a.describe}`);
  }
  console.log('\n  node scripts/entity/resolve.mjs <type> [--calibrate] [--scope=col=val] [--out=PATH] [--limit=N] [--verbose]\n');
  process.exit(0);
}

const adapter = ADAPTERS[type];
if (!adapter) { console.error(`unknown type "${type}". --list to see them.`); process.exit(2); }
if (adapter.delegated) {
  console.error(`\n"${type}" is DELEGATED, not unimplemented.\n\n  owner : ${adapter.delegated.to}\n  run   : ${adapter.delegated.run}\n\n  why   : ${adapter.delegated.why}\n`);
  process.exit(3);
}

console.log(`\nresolve.mjs ${RESOLVER_VERSION}  —  type=${type}  table=${adapter.table}`);

let rows = [];
if (adapter.loadCustom) {
  rows = await adapter.loadCustom();
  if (flag('limit')) rows = rows.slice(0, Number(flag('limit')));
} else {
  const scope = flag('scope');
  const tune = (q) => {
    if (scope) { const [col, ...v] = scope.split('='); return q.eq(col, v.join('=')); }
    if (adapter.defaultScope) return q.eq(adapter.defaultScope.path, adapter.defaultScope.value);
    return q;
  };
  const order = adapter.orderBy ?? 'id';
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tune(db.from(adapter.table).select(adapter.select)).order(order).range(from, from + 999);
    if (error) { console.error('LOAD FAIL:', error.message); process.exit(1); }
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  if (flag('limit')) rows = rows.slice(0, Number(flag('limit')));
}
const records = adapter.load(rows).filter((r) => r.name);
console.log(`loaded ${rows.length} rows -> ${records.length} named records`
  + (flag('scope') ? ` (scope ${flag('scope')})` : adapter.defaultScope ? ` (default scope ${adapter.defaultScope.path}=${adapter.defaultScope.value})` : ''));
records.forEach((r, i) => { r.idx = i; });

const bySource = {};
for (const r of records) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
console.log('by source:', Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join('  '));

if (has('calibrate')) { calibrate(records, adapter); process.exit(0); }

const { clusters, candidates, refusals, geoStats, contentStats } = resolve(records, adapter);

// ── report
console.log('\n' + '='.repeat(78));
console.log(`MERGE PROPOSALS: ${clusters.length} clusters covering ${clusters.reduce((s, c) => s + c.n_members, 0)} records`);
console.log('='.repeat(78));

const rungHist = {};
for (const c of clusters) for (const e of c.edges) rungHist[`${e.rung} ${e.rung_name}`] = (rungHist[`${e.rung} ${e.rung_name}`] ?? 0) + 1;
console.log('\nwhich rung carried each proposed edge:');
for (const [k, v] of Object.entries(rungHist).sort()) console.log(`  rung ${k}: ${v} edges`);
if (!Object.keys(rungHist).length) console.log('  (none)');
const promoted = clusters.flatMap((c) => c.edges).filter((e) => e.promoted);
if (promoted.length) console.log(`  (of which ${promoted.length} are rung-3 names PROMOTED by an independent corroborating signal)`);
if (geoStats.suppressed) console.log(`\ngeo: ${geoStats.suppressed} degenerate coordinates suppressed, removing ${geoStats.suppressedRows} records from rung 1`);
for (const [ch, deg] of Object.entries(contentStats.degenerate ?? {})) {
  if (deg.length) console.log(`content:${ch}: ${deg.length} degenerate keys suppressed — ${deg.slice(0, 3).map(([k, n]) => `${k}(${n} bearers)`).join(', ')}`);
}

const N = has('verbose') ? 1e9 : 12;
console.log('\n--- proposed merges (top ' + Math.min(N, clusters.length) + ') ---');
for (const c of clusters.slice(0, N)) {
  console.log(`\n  [${c.n_members}] ${c.members.map((m) => `"${m.name}"`).join('  ==  ')}`);
  console.log(`      sources: ${c.sources.join(', ')}`);
  for (const e of c.edges) {
    const detail = e.rung === 1 ? `${e.distance_m} m, name ${e.name_match}`
      : e.rung === 2 ? `${e.shared} shared ${e.channel} (${e.shared_keys.join(', ')})`
      : `name ${e.name_match}, corroborated by ${(e.corroborated_by ?? []).join('+') || 'nothing'}`;
    console.log(`      rung ${e.rung} ${e.rung_name}: ${detail}`);
  }
}

console.log(`\n--- REFUSED (${refusals.length}) — evidence existed, conclusion refused ---`);
const rHist = {};
for (const r of refusals) rHist[r.reason.split(' —')[0]] = (rHist[r.reason.split(' —')[0]] ?? 0) + 1;
for (const [k, v] of Object.entries(rHist).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(5)}  ${k}`);
for (const r of refusals.slice(0, has('verbose') ? 1e9 : 6)) console.log(`      "${r.a_name}" vs "${r.b_name}" — ${r.reason}`);

console.log(`\n--- CANDIDATES, LEFT UNMERGED (${candidates.length}) ---`);
const cHist = {};
for (const c of candidates) cHist[c.reason.split(' —')[0]] = (cHist[c.reason.split(' —')[0]] ?? 0) + 1;
for (const [k, v] of Object.entries(cHist).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(5)}  ${k}`);
for (const c of candidates.slice(0, has('verbose') ? 1e9 : 6)) console.log(`      "${c.a_name}" vs "${c.b_name}" — ${c.reason}`);

// ── reconcile against prior art (never overwrite it, never duplicate its writes)
if (adapter.priorArt) {
  const flagged = new Map();
  for (const r of rows) { const p = adapter.priorArt.read(r); if (p) flagged.set(r.id, p); }
  const proposedIds = new Set(clusters.flatMap((c) => c.members.map((m) => m.id)));
  const agree = [...flagged.keys()].filter((id) => proposedIds.has(id)).length;
  const onlyPrior = [...flagged.keys()].filter((id) => !proposedIds.has(id));
  const onlyHere = [...proposedIds].filter((id) => !flagged.has(id));
  console.log(`\n--- RECONCILIATION with ${adapter.priorArt.writer} (${adapter.priorArt.key}) ---`);
  console.log(`  rows already flagged there : ${flagged.size}`);
  console.log(`  also proposed here         : ${agree}`);
  console.log(`  flagged there, not here    : ${onlyPrior.length}`);
  console.log(`  proposed here, not flagged : ${onlyHere.length}   <- the new find`);
  for (const id of onlyHere.slice(0, has('verbose') ? 1e9 : 10)) {
    const r = records.find((x) => x.id === id);
    console.log(`      ${r.name}  (${r.source})`);
  }
  console.log(`\n  This tool does NOT write ${adapter.priorArt.key}. ${adapter.priorArt.writer} owns it.`);
}

const outPath = flag('out') ?? `output/entity/resolve-${type}-${new Date().toISOString().slice(0, 10)}.json`;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({
  resolver_version: RESOLVER_VERSION,
  subject_type: type,
  table: adapter.table,
  generated_at: new Date().toISOString(),
  scope: flag('scope') ?? adapter.defaultScope ?? null,
  records_loaded: records.length,
  rung_config: adapter.rungs,
  guards: { same_source: !!adapter.sameSourceGuard, twin_conflict: true,
    size_qualifier: true, must_agree: adapter.mustAgree ?? [], forbid_containment: !!adapter.forbidContainment },
  counts: { proposals: clusters.length, refusals: refusals.length, candidates: candidates.length },
  proposals: clusters,
  refusals: refusals.slice(0, 2000),
  candidates: candidates.slice(0, 2000),
  truncated: { refusals: Math.max(0, refusals.length - 2000), candidates: Math.max(0, candidates.length - 2000) },
  note: 'PROPOSALS ONLY. Nothing was written. Merging is a testimony operation and an owner decision: it must be reversible, must record lineage, and must never delete the absorbed record.',
}, null, 2));
console.log(`\nplan written: ${outPath}`);
console.log('NOTHING WAS WRITTEN TO THE DATABASE. These are proposals.\n');
