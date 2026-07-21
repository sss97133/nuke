#!/usr/bin/env node
/**
 * page-people-reconcile — compare the person layers that share ONE page.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE DEFECT (measured 2026-07-20, page 0004ccd5-8410-4f11-8d64-6a312f3b8899,
 * lofficiel-riviera-12 p21)
 * ════════════════════════════════════════════════════════════════════════════
 *   spatial_tags.people_in_image  -> {"name":"Katie Lister","role":"unknown"}
 *   spatial_tags.creative_credits -> {"name":"KATIE LISTER","role":"writer"}
 * Same page. Same human. Two layers. Never compared. An intern would not write
 * "unknown" beside a name printed as the byline six inches away.
 *
 * The cause is structural, not a model failure: `analyze_pages_v2.mjs` prompts
 * people_in_image.role with the enum `model|cover_star|subject|unknown`, which
 * has no slot for "writer". So a credited contributor who is also photographed
 * can only come back `unknown`. The information was never missing from the page
 * — it was in the sibling array all along.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE THREE LAYERS ARE THREE DIFFERENT AXES — this is why naive merging is wrong
 * ════════════════════════════════════════════════════════════════════════════
 *   people_in_image.role   PHOTOGRAPHIC — what they are in the photo
 *                          measured vocab: model 3084, unknown 633,
 *                          cover_star 504, subject 150, cover 71
 *   creative_credits.role  PRODUCTION  — what they did to make the page
 *                          photographer 3555, writer 1293, stylist 660 ...
 *   people_mentioned.role  DESCRIPTIVE — who they are in the world
 *                          artist 627, chef 168, architect 122 ...
 * A person may legitimately hold one role on each axis at once (Laurie Lynn
 * Stark, mag_people: Designer + Editor + Founder + Photographer). So this tool
 * NEVER replaces an informative role with another axis's role. It fills only
 * UNINFORMATIVE roles, and every other disagreement is recorded AS a conflict
 * (HANDOFF.md "THE FRAME": adjudicate per-field, surface conflicts as conflicts,
 * never resolve silently).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT IT REFUSES TO DO
 * ════════════════════════════════════════════════════════════════════════════
 * 1. It never guesses who is in a photograph. A generic in-image person
 *    ("model", null name) sitting on a page with exactly one uncredited named
 *    person is recorded as a CANDIDATE with its evidence and left unmerged.
 *    Guessing there is the fabrication this platform exists to prevent.
 * 2. It never writes to `spatial_tags`. That blob is the extractor's own
 *    testimony and `analyze_pages_v2.mjs` merges into it on every re-run
 *    (unionByKey) — our edit would either be clobbered or duplicated back as a
 *    second entry. Verdicts land in `publication_pages.metadata`, a namespaced
 *    sidecar the extractor never touches.
 * 3. It never adopts a role from a name that is not a name. The corpus carries
 *    measured prompt-placeholder echo (ANALYSIS_SPEC.md failure mode #2):
 *    "str" appears as a credit NAME 1,386 times and as a role 800 times, and
 *    the role words themselves appear as names ("photographer" 175, "stylist"
 *    48, "writer" 38). Those are the schema talking to itself, not people.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHERE THE VERDICT LANDS, AND WHY NOT AN OBSERVATION
 * ════════════════════════════════════════════════════════════════════════════
 * The sanctioned front door is `ingest-observation` via scripts/entity/observe.mjs.
 * It cannot carry this fact today: `validate.mjs` SUBJECTS records, measured,
 * that BOTH candidate subjects are inexpressible —
 *   person           expressible:false  // mag_people PK is TEXT; subject_id is uuid
 *   publication_page expressible:false  // subject_type CHECK rejects it
 * Faking a subject to get through the door would fork the fact. So v1 lands on
 * the page row in `metadata.people_reconciliation`, following the provenance
 * shape already in that column from the 2026-07-19 requeue sweep
 * ({source, method, observed_at, trust, evidence}) — "numbers carry source DNA".
 * SCHEMA PROPOSAL to graduate this to a real observation — FILED, not a note:
 *   schema_proposals 850c8ad1-3ebf-4682-9e64-8d803d4a1905 (status open,
 *   agent_key claude-opus-4-8[1m]-within-page-reconcile). It asks for exactly one
 *   thing: admit 'publication_page' to vehicle_observations_subject_type_chk.
 *   On approval, the sidecar written here is the backfill source.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * USAGE  (always: cd /Users/skylar/nuke && dotenvx run --quiet -- node ...)
 * ════════════════════════════════════════════════════════════════════════════
 *   node scripts/entity/page-people-reconcile.mjs              # measure, write nothing
 *   node scripts/entity/page-people-reconcile.mjs --apply      # land verdicts
 *   node scripts/entity/page-people-reconcile.mjs --verify     # CHECK: exit 1 on regression
 *   node scripts/entity/page-people-reconcile.mjs --page <id>  # explain one page
 * npm: `npm run reconcile:page-people[:apply|:verify]`
 *
 * --verify is the point. This finding is an executable check, not a paragraph:
 * if a future extraction run re-introduces adoptable "unknown"s, the check goes
 * red. Prose gets skipped; a red check does not.
 */
import { createClient } from '@supabase/supabase-js';

// Lazy — the reconciler itself is pure, and the selftest must be able to import
// it with no env at all. A module-level client would make the pure half
// unimportable and the test would quietly stop running. (Same shape as validate.mjs.)
let _db = null;
const sb = () => (_db ??= createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY));

export const METHOD = 'within_page_layer_reconcile';
export const VERSION = 4; // bump when the rules change; forces re-evaluation of stored verdicts
const SIDECAR_KEY = 'people_reconciliation';

// ── normalisation ───────────────────────────────────────────────────────────
// KATIE LISTER === Katie Lister === Kénzia === Kenzia. Accent-folding is not
// cosmetic here: the corpus carries "Kenzia Bengel de Vaulx" 61x and
// "KENZIA BENGEL DE VAULX" 28x as separate credit-name strings.
export const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── what is not a person ────────────────────────────────────────────────────
// Every entry below is a measured string from this corpus, not a hypothetical.
const NON_NAMES = new Set([
  'str', 'null', 'none', 'n a', 'na', 'unknown', 'undefined', 'string',
  'name', 'person', 'anonymous', 'various', 'staff', 'team',
]);
// A "name" that is only a role word is the schema echoing itself.
const ROLE_WORDS = new Set([
  'photographer', 'writer', 'stylist', 'editor', 'designer', 'model', 'artist',
  'publisher', 'production', 'casting', 'assistant', 'illustrator',
  'art director', 'art contributor', 'contributor', 'interviewer', 'interviewee',
  'chef', 'architect', 'founder', 'director', 'actor', 'actress', 'celebrity',
  'athlete', 'guest', 'journalist', 'brand', 'organization', 'location',
  'assistant stylist', 'contributing photographer', 'editor in chief',
  'brand representative', 'creative director', 'makeup artist', 'hair stylist',
]);
const PLACEHOLDER_RE = /all visible text|verbatim|str or null|your answer/i;

/** Is this string usable as a person's name? */
export function isName(raw) {
  const n = norm(raw);
  if (!n || n.length < 2) return false;
  if (NON_NAMES.has(n)) return false;
  if (ROLE_WORDS.has(n)) return false;          // "photographer" as a NAME
  if (PLACEHOLDER_RE.test(String(raw))) return false;
  if (!/[a-z]/.test(n)) return false;
  return true;
}

// ── generic (unidentified) in-image humans ──────────────────────────────────
const GENERIC_PERSON = new Set([
  'model', 'models', 'woman', 'women', 'man', 'men', 'girl', 'boy', 'person',
  'people', 'group', 'couple', 'child', 'children', 'female', 'male', 'figure',
  'unknown', 'subject', 'cover star', 'guest', 'crowd',
]);
/** A person instance with no identifying name — a body, not a human we can name. */
export const isGeneric = (raw) => !isName(raw) || GENERIC_PERSON.has(norm(raw));

// ── uninformative roles ─────────────────────────────────────────────────────
// The role field is PRESENT (17,134 of 17,139 instances carry one) but says
// nothing. This is the fillable set — the Katie Lister case.
const UNINFORMATIVE_ROLE = new Set(['', 'unknown', 'str', 'null', 'none', 'person', 'n a', 'na', 'undefined']);
export const roleIsUninformative = (r) => UNINFORMATIVE_ROLE.has(norm(r));

// Photographic-axis roles. Informative about the PHOTO, silent about the human.
const PHOTOGRAPHIC = new Set(['model', 'cover star', 'subject', 'cover']);
export const axisOf = (role) => (PHOTOGRAPHIC.has(norm(role)) ? 'photographic' : 'production_or_descriptive');

// ── the person/organisation seam ────────────────────────────────────────────
// The extractor files organisations in the people arrays. Eyeballed 2026-07-20:
// creative_credits carries "APM Monaco" as a stylist, "lofficiel_stbarth" as an
// editor, "L'Officiel" as an editor, "Perrotin gallery" as a gallery, and
// people_mentioned carries "CARLA SAINT BARTH" (a boutique) and 280 entries with
// role "brand". Adopting a role for those, or offering them as the human in a
// photograph, would fabricate a person. Two page-local tests, no outside lookup:
const NON_HUMAN_ROLE = new Set([
  'brand', 'boutique', 'gallery', 'organization', 'organisation', 'location',
  'publication', 'magazine', 'company', 'hotel', 'restaurant', 'association',
  'environmental association', 'label', 'house', 'store', 'shop', 'agency',
  'museum', 'foundation', 'venue', 'event', 'place', 'city', 'brands',
]);
/** Names the page itself files as a brand / business / location — not people. */
export function nonHumanNames(st) {
  const s = new Set();
  for (const k of ['brands', 'businesses', 'locations', 'properties']) {
    for (const e of (Array.isArray(st?.[k]) ? st[k] : [])) {
      const n = norm(e?.name);
      if (n) s.add(n);
    }
  }
  return s;
}

// ── role sets ───────────────────────────────────────────────────────────────
// "founder|chairman" and "founder_and_chairman" are the SAME claim spelled two
// ways (measured: page 3bb8c4c6, Frank Binder). "art director & curator" vs
// "art director, curator and journalist" is not a contradiction, it is one
// witness knowing more. Comparing raw strings calls both a conflict and buries
// the real ones. So a role becomes a SET of normalised components.
// Normalise FIRST, then tokenise. Splitting the raw string cannot see that
// "founder_and_chairman" contains a conjunction (underscore is a word character,
// so \band\b never matches) — measured: that pair was reported as a conflict on
// page 3bb8c4c6 when it is one claim spelled twice. norm() flattens every
// separator to whitespace, so one tokenizer then handles |, &, _, / and prose.
const ROLE_STOPWORDS = new Set(['and', 'et', 'ou', 'or', 'of', 'de', 'du', 'des', 'la', 'le', 'les', 'the', 'a', 'in']);
export function roleSet(role) {
  return new Set(norm(role).split(' ').filter(t => t && !ROLE_STOPWORDS.has(t)));
}
const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const subsetOf = (a, b) => a.size < b.size && [...a].every(x => b.has(x));
/** '', 'same', 'subsumption', or 'conflict' — how two role claims relate. */
export function roleRelation(r1, r2) {
  const a = roleSet(r1), b = roleSet(r2);
  if (!a.size || !b.size) return 'same';
  if (setEq(a, b)) return 'same';
  if (subsetOf(a, b) || subsetOf(b, a)) return 'subsumption';
  return 'conflict';
}

const arr = (v) => (Array.isArray(v) ? v : []);

// ════════════════════════════════════════════════════════════════════════════
// THE RECONCILER — pure. One page in, one verdict out. No IO, so it is testable.
// ════════════════════════════════════════════════════════════════════════════
export function reconcilePage(spatial_tags) {
  const st = spatial_tags || {};
  const layers = {
    people_in_image: arr(st.people_in_image),
    creative_credits: arr(st.creative_credits),
    people_mentioned: arr(st.people_mentioned),
  };

  const nonHuman = nonHumanNames(st);
  /** Page-local test: is this entry a human at all? */
  const isHuman = (p) => isName(p?.name)
    && !NON_HUMAN_ROLE.has(norm(p?.role))
    && !nonHuman.has(norm(p?.name));

  // Index every NAMED HUMAN instance on the page by normalised name.
  // key -> [{layer, idx, name, role}]
  const byName = new Map();
  const excluded_non_human = [];
  for (const [layer, list] of Object.entries(layers)) {
    list.forEach((p, idx) => {
      if (!isName(p?.name)) return;
      if (!isHuman(p)) {
        excluded_non_human.push({ layer, idx, name: p.name, role: p?.role ?? null,
          why: NON_HUMAN_ROLE.has(norm(p?.role)) ? 'role names an organisation' : 'the page files this name as a brand/business/location' });
        return;
      }
      const k = norm(p.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push({ layer, idx, name: p.name, role: p?.role ?? null });
    });
  }

  const adopted = [];    // uninformative role filled from a sibling layer
  const conflicts = [];  // two layers, same human, incompatible claims — NEVER resolved
  const candidates = []; // a generic body + a lone unmatched name — NEVER merged

  for (const [key, insts] of byName) {
    if (insts.length < 2) continue; // one layer only — nothing to reconcile against

    // Distinct informative role claims for this human anywhere on the page,
    // deduped by role SET so two spellings of one claim are one claim.
    const informative = insts.filter(i => !roleIsUninformative(i.role));
    const distinct = [];
    for (const i of informative) {
      if (!distinct.some(d => roleRelation(d.role, i.role) === 'same')) distinct.push(i);
    }

    for (const inst of insts) {
      if (!roleIsUninformative(inst.role)) continue;
      const donors = distinct.filter(d => d.layer !== inst.layer);
      if (donors.length === 0) continue;

      // Donors that differ only by specificity are ONE claim at different
      // resolutions. Adopt the claim every donor supports — the common subset —
      // never the most specific. Asserting more than every witness supports is
      // exactly the over-claim this platform exists to stop.
      let pick = donors[0], relation = 'sole_donor';
      if (donors.length > 1) {
        const allSubsumption = donors.every((d, i2) => donors.every((e, j) =>
          i2 === j || roleRelation(d.role, e.role) !== 'conflict'));
        if (!allSubsumption) {
          conflicts.push({
            kind: 'ambiguous_donor', name: inst.name, key,
            target: { layer: inst.layer, idx: inst.idx, role: inst.role },
            donors: donors.map(d => ({ layer: d.layer, role: d.role, name: d.name })),
            resolution: 'NOT ADOPTED — two sibling layers claim different roles and neither outranks the other.',
          });
          continue;
        }
        pick = donors.reduce((a, b) => (roleSet(a.role).size <= roleSet(b.role).size ? a : b));
        relation = 'least_specific_of_agreeing_donors';
      }
      adopted.push({
        name: inst.name, key,
        target: { layer: inst.layer, idx: inst.idx },
        was: inst.role ?? null,
        role: pick.role,
        role_axis: axisOf(pick.role),
        donor_relation: relation,
        from: { layer: pick.layer, name: pick.name },
      });
    }

    // Same human, two layers, two DIFFERENT informative role claims.
    if (distinct.length > 1) {
      // Classified, not resolved. Eyeballed 2026-07-20, the three classes are
      // genuinely different things and lumping them overstated the defect:
      //   subsumption   "photographer" vs "contributing photographer" — one
      //                 witness is more specific. Not a contradiction.
      //   same_axis     both photographic ("cover_star" vs "model") — near
      //                 synonyms from one axis; low-value disagreement.
      //   cross_axis    "model" vs "photographer" — different axes, both can be
      //                 true (mag_people: Laurie Lynn Stark holds four roles).
      // Only pairs that are neither subsumed nor cross-axis are real contests.
      const pairs = [];
      for (let i2 = 0; i2 < distinct.length; i2++) for (let j = i2 + 1; j < distinct.length; j++) {
        const rel = roleRelation(distinct[i2].role, distinct[j].role);
        if (rel === 'same') continue;
        pairs.push({ rel, a: distinct[i2], b: distinct[j] });
      }
      if (pairs.length) {
        const anyReal = pairs.some(p => p.rel === 'conflict'
          && axisOf(p.a.role) === axisOf(p.b.role)
          && !(PHOTOGRAPHIC.has(norm(p.a.role)) && PHOTOGRAPHIC.has(norm(p.b.role))));
        const allSubsumed = pairs.every(p => p.rel === 'subsumption');
        conflicts.push({
          kind: allSubsumed ? 'role_specificity_difference'
              : anyReal ? 'role_conflict_same_axis' : 'role_conflict_cross_axis',
          name: distinct[0].name, key,
          claims: distinct.map(d => ({ layer: d.layer, role: d.role, name: d.name })),
          resolution: 'NOT RESOLVED — recorded as a conflict. Adjudication needs an editor or the printed page (T1/T2), not a vote between two T4 reads.',
        });
      }
    }
  }

  // ── candidates: a body we cannot name, beside a name we cannot place ───────
  // Recorded, never merged. The evidence is attached so a human (or a stronger
  // model reading the actual image) can close it later.
  const genericInImage = layers.people_in_image
    .map((p, idx) => ({ idx, name: p?.name ?? null, role: p?.role ?? null, bbox: p?.bbox ?? p?.bounding_box ?? null }))
    .filter(p => isGeneric(p.name));
  const inImageNames = new Set(layers.people_in_image.filter(p => isName(p?.name)).map(p => norm(p.name)));
  const uncreditedNamed = [];
  for (const layer of ['creative_credits', 'people_mentioned']) {
    for (const p of layers[layer]) {
      if (!isHuman(p)) continue;   // a boutique is never the person in the photo
      const k = norm(p.name);
      if (inImageNames.has(k)) continue;               // already placed in the image
      if (uncreditedNamed.some(u => u.key === k)) continue;
      uncreditedNamed.push({ key: k, name: p.name, role: p?.role ?? null, layer });
    }
  }
  if (genericInImage.length === 1 && uncreditedNamed.length === 1) {
    candidates.push({
      kind: 'lone_generic_lone_name',
      unnamed: genericInImage[0],
      possible: uncreditedNamed[0],
      evidence: 'exactly one unidentified person in the image and exactly one named person on the page not otherwise placed',
      resolution: 'NOT MERGED — identifying a face from co-occurrence is fabrication. Needs a look at the image or an editor sign-off.',
    });
  }

  return { adopted, conflicts, candidates, excluded_non_human };
}

const isEmptyVerdict = (v) => !v.adopted.length && !v.conflicts.length && !v.candidates.length;

// Postgres `jsonb` does not preserve object key order — it stores keys sorted by
// (length, bytes). So a plain JSON.stringify comparison between what we computed
// and what we read back NEVER matches, every run rewrites all 1,144 rows, and
// --verify fails immediately after a successful --apply. Measured 2026-07-20.
// Canonicalise both sides before comparing.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]));
  }
  return v;
}
const stable = (v) => JSON.stringify(canon(v));

// ════════════════════════════════════════════════════════════════════════════
// IO
// ════════════════════════════════════════════════════════════════════════════
async function pageAll(table, select, filt) {
  const out = []; let i = 0;
  for (;;) {
    let q = sb().from(table).select(select).order('id').range(i, i + 999);
    if (filt) q = filt(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;   // exactly 1000 = PostgREST cap, keep paging
    i += 1000;
  }
  return out;
}

function envelope(verdict, page) {
  return {
    source: 'scripts/entity/page-people-reconcile.mjs',
    method: METHOD,
    version: VERSION,
    trust: 'derived',   // derived from T4 vision testimony — never outranks printed (T2)
    observed_at: new Date().toISOString(),
    evidence: `within-page comparison of spatial_tags.people_in_image / creative_credits / people_mentioned on page ${page.page_number}`,
    note: 'spatial_tags is NOT modified. These are verdicts about the extractor output, not a replacement for it.',
    ...verdict,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const APPLY = argv.includes('--apply');
  const VERIFY = argv.includes('--verify');
  const ONE = argv.includes('--page') ? argv[argv.indexOf('--page') + 1] : null;

  let rows;
  if (ONE) {
    const { data, error } = await sb().from('publication_pages')
      .select('id,page_number,publication_id,spatial_tags,metadata').eq('id', ONE);
    if (error) throw new Error(error.message);
    rows = data;
  } else {
    rows = await pageAll('publication_pages', 'id,page_number,publication_id,spatial_tags,metadata',
      q => q.not('spatial_tags', 'is', null));
  }

  const stats = {
    pages_scanned: rows.length, pages_with_people: 0, pages_with_verdict: 0,
    person_instances: 0, named_instances: 0, junk_names: 0, non_human_excluded: 0,
    uninformative_roles: 0, uninformative_roles_fillable: 0, roles_filled: 0,
    conflicts: 0, conflicts_same_axis: 0, conflicts_cross_axis: 0,
    conflicts_ambiguous: 0, specificity_differences: 0,
    candidates: 0, already_current: 0, written: 0, write_errors: 0,
  };
  const byRole = new Map();
  const unreconciled = [];   // for --verify
  const writes = [];

  for (const r of rows) {
    const st = r.spatial_tags || {};
    const people = [...arr(st.people_in_image), ...arr(st.people_mentioned)];
    stats.person_instances += people.length;
    for (const p of people) { if (isName(p?.name)) stats.named_instances++; else stats.junk_names++; }
    for (const p of [...people, ...arr(st.creative_credits)]) if (roleIsUninformative(p?.role)) stats.uninformative_roles++;
    if (people.length || arr(st.creative_credits).length) stats.pages_with_people++;

    const v = reconcilePage(st);
    if (isEmptyVerdict(v)) continue;
    stats.pages_with_verdict++;
    stats.roles_filled += v.adopted.length;
    stats.conflicts += v.conflicts.length;
    stats.candidates += v.candidates.length;
    stats.non_human_excluded += v.excluded_non_human.length;
    // FILLABLE — the honest denominator. progressive-extraction.md: coverage is
    // yield / fillable, never yield / total. An uninformative role with no donor
    // anywhere on its own page is at ceiling, not a miss.
    stats.uninformative_roles_fillable += v.adopted.length + v.conflicts.filter(c => c.kind === 'ambiguous_donor').length;
    for (const c of v.conflicts) {
      if (c.kind === 'ambiguous_donor') stats.conflicts_ambiguous++;
      else if (c.kind === 'role_specificity_difference') stats.specificity_differences++;
      else if (c.kind === 'role_conflict_same_axis') stats.conflicts_same_axis++;
      else stats.conflicts_cross_axis++;
    }
    for (const a of v.adopted) byRole.set(a.role, (byRole.get(a.role) || 0) + 1);

    const stored = r.metadata?.[SIDECAR_KEY];
    const current = stored && stored.version === VERSION
      && stable({ a: stored.adopted, c: stored.conflicts, k: stored.candidates })
         === stable({ a: v.adopted, c: v.conflicts, k: v.candidates });
    if (current) { stats.already_current++; continue; }
    if (v.adopted.length) unreconciled.push({ page: r.id, n: v.adopted.length });
    writes.push({ id: r.id, metadata: { ...(r.metadata || {}), [SIDECAR_KEY]: envelope(v, r) } });

    if (ONE) console.log(JSON.stringify(v, null, 2));
  }

  if (APPLY) {
    for (let i = 0; i < writes.length; i += 200) {
      const batch = writes.slice(i, i + 200);
      const results = await Promise.all(batch.map(w =>
        sb().from('publication_pages').update({ metadata: w.metadata }).eq('id', w.id)));
      for (const res of results) { if (res.error) { stats.write_errors++; if (stats.write_errors < 4) console.error('WRITE', res.error.message); } else stats.written++; }
      process.stderr.write(`\r  written ${stats.written}/${writes.length}`);
    }
    process.stderr.write('\n');
  }

  console.log('\n══ within-page person-layer reconciliation ══');
  console.log(JSON.stringify(stats, null, 2));
  const f = stats.uninformative_roles_fillable;
  console.log(`\ncoverage = filled / fillable = ${stats.roles_filled}/${f} = ${f ? (100 * stats.roles_filled / f).toFixed(1) : '0'}%`);
  console.log(`  (filled / ALL uninformative roles = ${stats.roles_filled}/${stats.uninformative_roles} — the WRONG denominator;`);
  console.log('   a role with no donor on its own page is at ceiling, not a miss. progressive-extraction.md)');
  console.log('\nroles filled, by adopted role:', JSON.stringify([...byRole.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)));

  if (VERIFY) {
    // THE CHECK. An adoptable "unknown" that no verdict covers is the defect
    // returning. Red here means a new extraction run re-opened it — re-run
    // --apply, do not re-derive the reconciler.
    if (unreconciled.length) {
      console.error(`\nFAIL: ${unreconciled.length} pages carry ${unreconciled.reduce((s, u) => s + u.n, 0)} adoptable person roles with no current verdict.`);
      console.error('  fix: npm run reconcile:page-people:apply');
      console.error('  first 5:', JSON.stringify(unreconciled.slice(0, 5)));
      process.exit(1);
    }
    console.log('\nPASS: every adoptable in-page person role carries a current reconciliation verdict.');
  }
  if (!APPLY && !VERIFY && !ONE) console.log('\n(dry run — nothing written. --apply to land verdicts.)');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exit(1); });
}
