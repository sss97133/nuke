#!/usr/bin/env node
// Adjudicate EARNED EDITORIAL PRESENCE for L'Officiel concierge orgs.
//
// Doctrine (AGENTS.md "FACTS ARE SACRED" + lofficiel-concierge/HANDOFF.md "THE FRAME"):
//   - The magazine is a WITNESS, not an authority. Its testimony is adjudicated, not trusted.
//   - AD vs EDITORIAL comes from the STORY SPINE (mag_spine_page_kinds -> mag_is_ad), NEVER
//     from vision page_type. Paid presence is not earned presence — different claims entirely.
//   - Nothing is generated. Every accepted link cites issue + page + verbatim evidence.
//   - ENTITY GATE: a magazine string is evidence about an ORG only if it denotes THAT org.
//     Sharing a token is not enough. A false editorial link is a false prestige claim on a
//     paying client's profile — the worst defect this product can ship. Hence every candidate
//     is machine-generated but HAND-ADJUDICATED against the page text (VERDICTS below).
//   - Fill-only-empty: an org already carrying organization_brands rows is left untouched.
//   - NEVER DELETE. This script only inserts.
//
// Usage:
//   node scripts/concierge/link-org-editorial.mjs <canon_issues.json> [--apply] [--out DIR]
//
// canon_issues.json maps publication_id -> mag_canon_issue(publications), a Postgres function
// with no REST surface. Regenerate with:
//   select json_object_agg(id, mag_canon_issue(p.*)) from publications p
//     where p.publisher_slug in ('lofficiel_stbarth','lofficiel_riviera');

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : '.';
const CANON = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const PUB_IDS = Object.keys(CANON);
const RUN = '2026-07-19-editorial-crosslink';

// ---------------------------------------------------------------------------
// THE VERDICTS — one line per candidate the matcher surfaced, each decided by
// reading the actual page text. `accept` writes a link; everything else is
// reported and never written. The rejected list is as load-bearing as the
// accepted one: it is the record of prestige claims this system refused to make.
// ---------------------------------------------------------------------------
const VERDICTS = {
  // ---- ACCEPTED: the magazine's own editorial prose/credits denote THIS island house ----
  'LE TOINY': ['accept', 'editorial prose across 4+ issues: "hotel le toiny", "le toiny beach club", "le toiny offers a luxurious escape on st barth s serene southeastern shore"'],
  'LE CARL GUSTAF': ['accept', 'dedicated feature "le carl gustaf — all eyes on the new kid in town"; repeated shoot credits "photographed at hotel barriere le carl gustaf"'],
  'WALL HOUSE': ['accept', 'editorial prose "the wall house museum"; caption "musee territorial wall house la pointe gustavia" — the island territorial museum'],
  'NIKKI BEACH': ['accept', 'Riviera editorial prose "il est de rigueur de faire une escale au nikki beach" + St Barth outlet block "plage de saint jean 97133 saint barth" + TOC feature entry'],
  'OCEAN CLUB ST BARTHS': ['accept', 'dedicated feature + TOC: "welcome to the club — ocean club st barths arrival on the island brings a dinner spot…" (interview with head chef)'],
  'MANAPANY': ['accept', 'editorial prose "my first press interview … at hotel manapany" and "entre deux massages au spa payot du manapany"'],
  'SPA EXCELLENCE DES SENS': ['accept', 'wellness feature: "christophe marchesseau s spa excellence des sens is located on the third floor of the luxurious cour vendome … in the heart of gustavia"'],
  'BAR DES PRES': ['accept', 'dedicated Cyril Lignac interview: "why did you choose st barth to open a bar des pres" + TOC entry'],
  'LE SERENO': ['accept', 'renovation feature: "guillermo de yavorsky has just finished renovating of the hotel le sereno after the damages caused by hurricane irma"'],
  'LE TI ST-BARTH': ['accept', 'edito "the legendary le ti st barth has embraced reinvention" + a full origin story of the venue'],
  'TROPICAL HOTEL': ['accept', 'feature "tropical pause at the brand new tropical hotel in the powder pink garden" + TOC entry'],
  'NAO BEACH': ['accept', 'editorial prose "an intimate candlelit dinner at nao beach complete with cocktails sparklers and dancing"'],
  'LE PAPILLON IVRE': ['accept', 'feature "take flight at le papillon ivre — from exceptional wine flights to comforting french classics"'],
  'ARAWAK CAFE': ['accept', 'feature "food — arawak cafe, one stop shop … a lively place in the heart of gustavia"'],
  'SAINT BARTH ESSENTIEL': ['accept', 'editorial prose "among them we should first mention saint barth essentiel created in june 2009 which notably promotes…"'],
  'LE SELECT': ['accept', 'editorial prose "whether enjoying a casual lunch at le select or indulging in a meal at cheval blanc"'],
  'CHEVAL BLANC SAINT BARTHELEMY': ['accept', 'vision brand tag on 3 editorial pages across 3 issues, 0 ad pages; corroborated in prose "cheval blanc st barth isle de france"'],
  'BAGATELLE ST BARTH': ['accept', 'vision brand tag on 3 editorial pages / 2 issues (plus 2 ad pages, recorded separately)'],
  'SiBarth': ['accept', 'vision brand tag on 2 editorial pages; corroborated by shoot credit "location villa mayflower at sibarth"'],
  'PASHA ST BARTH': ['accept', 'editorial fashion credit naming the house as the maker: "color cap in cotton — pasha st barth"'],
  'LA GUERITE': ['accept_with_conflict', 'St Barth outlet named in a contributor masthead bio ("she collaborates with … la guerite") and in a St Barth contact block; the long editorial prose describes the CANNES outlet (ile Sainte-Marguerite). Same house, different outlet — conflict recorded, not resolved.'],

  // ---- REJECTED: the name matched, the entity did not ----
  "L'ESPRIT": ['reject', 'COMMON NOUN. All 30 hits are the French word "l\'esprit" (the spirit/mind): "l\'esprit de francis scott fitzgerald", "l\'esprit de partage". Zero denote the restaurant.'],
  'PERSPECTIVES': ['reject', 'COMMON NOUN. All 14 hits are the ordinary word: "ready to experience new perspectives", "luminous perspectives and transparencies".'],
  'LINDBERGH': ['reject', 'PERSON, NOT ORG. Every hit is a photographer — Isabelle Lindbergh (contributor) or Peter Lindbergh (named among "les plus grands maitres de la photographie").'],
  'BRIANNE SMITH': ['reject', 'PERSON. Hair stylist in shoot credits ("hair brianne smith"). A creative credit is presence for a PERSON, not an org-brand relationship.'],
  'ELISA BALLY': ['reject', 'PERSON. Photographer credit ("photo elisa bally").'],
  'PORT DE GUSTAVIA': ['reject', 'GEOGRAPHY. "au port de gustavia" is the harbour, used to locate other businesses.'],
  'BODY CARE': ['reject', 'COMMON PHRASE. "face and body care postural treatments", "oils necessary for body care".'],
  'MARTINI BAR': ['reject', 'DIFFERENT REFERENT. "a hidden martini bar" inside the Dolce & Gabbana store, and "martini bar milano" in a thanks list.'],
  'MONTAIGNE MARKET': ['reject', 'STOCKIST CREDIT, NOT SELF-BRAND. "available at montaigne market st barth" credits them as a retailer of another house; the other hit is the Paris store. Belongs to the stockist class (see report).'],
  'Villa Marie': ['reject', 'WRONG PROPERTY. All hits are "la villa marie saint tropez, 1100 chemin de val rian, 83350 ramatuelle" — a Riviera hotel, not the St Barth villa org.'],
  'Villa Rock': ['reject', 'SUBSTRING FALSE MATCH. The text says "villa rock star et columbus" — Villa Rock Star, a different property.'],
  'CAPITAINERIE': ['reject', 'GENERIC + WRONG PLACE. "lounge club de la capitainerie" in a Saint-Tropez evening itinerary.'],
  'LA POSTE': ['reject', 'STREET ADDRESS. "2 rue de la poste, saint tropez" in a Vilebrequin boutique list.'],
  'LES ARTISANS': ['reject', 'COMMON PHRASE. "les artisans de dior" — Dior\'s craftspeople.'],
  'LA LANGOUSTE': ['reject', 'WRONG VENUE. "la langouste sur le toit" is a Riviera rooftop restaurant.'],
  'LE REPAIRE': ['reject', 'COMMON NOUN. "il est le repaire eternel des grands noms du septieme art" — describing Hotel Martinez.'],
  'GEM SELECTION': ['reject', 'COMMON PHRASE. "from meticulous gem selection to sketches created in the lyon atelier".'],
  'CAPUCINES': ['reject', 'PRODUCT NAME. "capucines bb bag in crocodilian rouge carmin leather, louis vuitton" — an LV handbag model.'],
  'PETIT BATEAU': ['reject', 'COMMON PHRASE. "poissons de petit bateau" (small-boat fish) at a Saint-Tropez market.'],
  'PAIN DE SUCRE': ['reject', 'GEOGRAPHY. "gros ilets, pain de sucre, iles fourchues" — islets inside the nature reserve.'],
  'LA PETITE PLAGE': ['reject', 'WRONG VENUE. "un dejeuner caritatif est servi a la petite plage" in a Saint-Tropez event.'],
  'BEACH HOUSE ST. BARTH': ['reject', 'AMBIGUOUS REFERENT. Hits are interior-design captions of a private residence ("living room beach house montjean st barth"), not the restaurant.'],
  'LE TAMARIN': ['reject', 'INSUFFICIENT. Single masthead name-drop inside a PR consultant\'s bio; no editorial coverage of the venue.'],
  'LA GUERITE BEACH': ['reject', 'DUPLICATE ORG ROW of LA GUERITE, and its only hit is the same contact block. Quarantine candidate for the dedupe pass.'],
  'SPACE SBH': ['reject', 'ADVERTORIAL SHAPE. Only hit is a contact block ("visit us at le carre d or … info spacesbh com") on a spine-"story" page. Spine/content conflict — reported, not credited.'],
  'MAISON PELICAN': ['reject', 'ADVERTORIAL SHAPE. Only hit is a listing with address + two phone numbers + "show room sur rdv".'],
  'GYP SEA BEACH': ['reject', 'ADVERTORIAL SHAPE. Only hit is a listing with phone, email and website.'],
  'CORCORAN ST BARTH': ['reject', 'ADVERTORIAL SHAPE + TRADEMARK BOILERPLATE: "corcoran.com/st-barth © 2020 corcoran group llc all rights reserved, corcoran and the corcoran logo are registered…". Spine says "story"; the content is a paid page. Reported as a spine misclassification.'],
  'BARNES INTERNATIONAL': ['reject', 'ADVERTORIAL SHAPE. "barnes international realty — a louer saint barth villa d exception…" is a property listing.'],
  'EDEN ROCK VILLA RENTAL': ['reject', 'ADVERTORIAL SHAPE. Only hit is a partner/URL credit line ("www edenrockvillarental com").'],
  'SIBARTH REAL ESTATE': ['reject', 'INSUFFICIENT. 1 editorial + 1 ad page, evidence is a listing block; the trading house SiBarth is accepted separately on prose.'],
  'VARDA': ['reject', 'ADVERTISING ONLY. 2 ad pages, 0 editorial. Paid presence is not earned presence.'],

  // ---- REPORTED, NOT WRITEABLE: real editorial presence with no honest home in this table ----
  'Villa Angelina': ['no_schema_home', 'SHOOT-LOCATION CREDIT ("photographed at villa angelina", 3 pages). Real earned presence, but a property-hosted-a-production relationship is not an org->brand authorization.'],
  'Villa Mayflower': ['no_schema_home', 'SHOOT-LOCATION CREDIT ("location villa mayflower at sibarth"). Property/production relationship.'],
  'Villa Wings': ['no_schema_home', 'SHOOT-LOCATION CREDIT ("remerciements a la villa wings", "with thanks to villa wings").'],
  'Villa Pointe Milou': ['no_schema_home', 'SHOOT-LOCATION CREDIT ("shot at … villa pointe milou").'],
  'Villa Jangali': ['no_schema_home', 'SHOOT-LOCATION CREDIT ("with thanks to villa jangali").'],
  'Villa Mythique': ['no_schema_home', 'SHOOT-LOCATION CREDIT ("jouer les muses pour nous a la villa mythique").'],
  'Villa Valentina': ['no_schema_home', 'PROJECT CREDIT inside an architect profile ("she has recently finished working on villa valentina"). Property/production relationship, not an org->brand authorization.'],
};

// PostgREST hard-caps every response at 1000 rows and silently clamps .limit() above it.
// Every read here goes through pagedAll or it is a lie about the table.
async function pagedAll(table, select, tune = (q) => q, orderCol = 'id') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tune(db.from(table).select(select))
      .order(orderCol, { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// ---------- normalization ----------

const fold = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
// The island suffix is a storefront's address, not part of its mark: "CULT GAIA ST BARTHS" and
// "Cult Gaia" are the same house. Stripped from BOTH sides so the comparison is symmetric.
const ISLAND = /[\s,'’.\-]*(de\s+|du\s+)?(st|st\.|saint)[\s.\-]*(barth[a-z]*|bart[s]?|bh)\s*$/i;
const key = (s) => fold(s).toLowerCase().replace(ISLAND, '').replace(/[^a-z0-9]/g, '');
const words = (s) => fold(s).toLowerCase().replace(ISLAND, '').split(/[^a-z0-9]+/).filter(Boolean);
const flat = (s) => ' ' + fold(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

// STRUCTURAL tokens carry no identity at all (articles, legal forms, category nouns). An org
// built only from these cannot be identified by name. Place names are deliberately NOT in this
// list: on this island the place IS often the house ("Le Toiny", "Pointe Milou").
const STRUCTURAL = new Set(('the a an and le la les de du des el il lo of at by for on in to' +
  ' saint st barth barths barthelemy sbh sarl sas sasu eurl inc ltd llc co cie group groupe' +
  ' restaurant restaurants bar bars cafe brasserie bistro pizzeria hotel hotels villa villas' +
  ' boutique boutiques shop shops store stores beach club plage spa salon studio gallery galerie' +
  ' jewelry jewellery bijouterie joaillerie immobilier estate realty agence agency services' +
  ' service company maison house center centre new my mon ma art design home living rental' +
  ' rentals location locations charter market marche food drinks lounge resort suites rooms' +
  ' room guest guests travel tours tour fashion mode style luxe luxury collection collections' +
  ' international realty museum musee').split(/\s+/));

const identifying = (s) => words(s).filter((w) => !STRUCTURAL.has(w));

// ---------- ad/editorial classification: THE STORY SPINE IS THE AUTHORITY ----------

// Mirrors mag_is_ad(canon, vphash, fallback_page_type): spine kind wins; vision page_type is
// only the fallback for pages the spine has never keyed.
const AD_KINDS = new Set(['ad', 'directory', 'back']);

// ---------- run ----------

const log = (...a) => console.error(...a);

log('reading substrate…');
const [supply, existingLinks, spine, pagesRaw, pubsRaw] = await Promise.all([
  pagedAll('concierge_supply_stbarth', 'org_id,name,concierge_category,relevance_tier,city', (q) => q, 'org_id'),
  pagedAll('organization_brands', 'organization_id,brand_name,authorization_level', (q) => q),
  pagedAll('mag_spine_page_kinds', 'canon,vphash,kind', (q) => q, 'canon'),
  pagedAll('publication_pages', 'id,publication_id,page_number,page_type,phash,spatial_tags,extracted_text',
    (q) => q.in('publication_id', PUB_IDS)),
  pagedAll('publications', 'id,slug,title,issue_number,metadata,publisher_slug', (q) => q.in('id', PUB_IDS)),
]);
log(`  supply ${supply.length} · existing links ${existingLinks.length} · spine ${spine.length} · pages ${pagesRaw.length}`);

const pubById = new Map(pubsRaw.map((p) => [p.id, p]));
const spineByKey = new Map(spine.map((s) => [`${s.canon} ${s.vphash}`, s.kind]));
const linkedOrgs = new Set(existingLinks.map((l) => l.organization_id));

// Per-page classification, deduped as every mag_* RPC dedupes: (canon_issue, vphash).
// Cover-variants share byte-identical inner pages; counting them twice inflates a footprint.
const pages = [];
const seenPage = new Set();
for (const p of pagesRaw) {
  const canon = CANON[p.publication_id];
  if (!canon) continue;
  const vphash = p.phash || `id:${p.id}`;
  const dk = `${canon} ${vphash}`;
  if (seenPage.has(dk)) continue;
  seenPage.add(dk);
  const kind = spineByKey.get(dk);
  const pub = pubById.get(p.publication_id);
  pages.push({
    canon, vphash, page: p.page_number, slug: pub?.slug, cover: pub?.title,
    issue_no: pub?.metadata?.issue_no || pub?.issue_number || '',
    spine_kind: kind ?? null, page_type: p.page_type,
    is_ad: kind !== undefined ? AD_KINDS.has(kind) : /ad/i.test(p.page_type || ''),
    // dedupe brand names WITHIN a page: one tag repeated is one page of presence, not two
    brands: [...new Map((p.spatial_tags?.brands || [])
      .filter((b) => String(b?.suspect) !== 'true' && String(b?.name || '').trim().length > 1)
      .map((b) => [key(b.name), String(b.name).trim()])).entries()],
    text: flat(p.extracted_text || ''),
  });
}
const edPages = pages.filter((p) => !p.is_ad);
log(`  deduped pages ${pages.length} (${pages.length - edPages.length} ad · ${edPages.length} editorial per the story spine)`);

const cite = (p) => ({
  issue: p.issue_no ? `#${String(p.issue_no).replace(/^#/, '')}` : p.canon,
  canon: p.canon, slug: p.slug, cover: p.cover, page: p.page,
  spine_kind: p.spine_kind ?? `(no spine row; vision page_type=${p.page_type})`,
});

// ---- evidence gathering: two independent witnesses over the same owned corpus ----
const evidence = new Map(); // org_id -> { org, brand_tag:{ed,ad,forms}, text:{ed} }
for (const org of supply) {
  if (linkedOrgs.has(org.org_id)) continue; // fill-only-empty
  const k = key(org.name);
  if (k.length < 4) continue;
  if (!identifying(org.name).length) continue; // every token structural — unidentifiable by name

  const tagEd = [], tagAd = [], forms = new Set();
  for (const p of pages) {
    for (const [bk, form] of p.brands) {
      if (bk !== k) continue;
      forms.add(form);
      (p.is_ad ? tagAd : tagEd).push(p);
    }
  }
  const needle = flat(org.name);
  const textEd = needle.trim().length >= 8 ? edPages.filter((p) => p.text.includes(needle)) : [];

  if (!tagEd.length && !tagAd.length && !textEd.length) continue;
  evidence.set(org.org_id, { org, forms: [...forms], tagEd, tagAd, textEd });
}
log(`  orgs with any magazine witness: ${evidence.size}`);

// ---- adjudication ----
const accepted = [], rejected = [], unreviewed = [];
for (const [org_id, e] of evidence) {
  const v = VERDICTS[e.org.name];
  const row = {
    org_id, org: e.org.name, category: e.org.concierge_category, tier: e.org.relevance_tier, city: e.org.city,
    brand_forms: e.forms,
    editorial_pages_brand_tag: e.tagEd.length,
    ad_pages_brand_tag: e.tagAd.length,
    editorial_pages_text: e.textEd.length,
    editorial_issues: [...new Set([...e.tagEd, ...e.textEd].map((p) => p.canon))].length,
    citations: [...new Map([...e.tagEd, ...e.textEd].map((p) => [`${p.canon}|${p.page}`, p])).values()]
      .sort((a, b) => a.canon.localeCompare(b.canon) || a.page - b.page).map(cite),
    ad_citations: e.tagAd.map(cite),
  };
  if (!v) { unreviewed.push(row); continue; }
  const [verdict, reason] = v;
  row.verdict = verdict; row.reason = reason;
  if (verdict === 'accept' || verdict === 'accept_with_conflict') accepted.push(row);
  else rejected.push(row);
}

accepted.sort((a, b) => (b.editorial_pages_text + b.editorial_pages_brand_tag) - (a.editorial_pages_text + a.editorial_pages_brand_tag));
rejected.sort((a, b) => (b.editorial_pages_text + b.editorial_pages_brand_tag) - (a.editorial_pages_text + a.editorial_pages_brand_tag));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'editorial_accepted.json'), JSON.stringify(accepted, null, 2));
fs.writeFileSync(path.join(OUT, 'editorial_rejected.json'), JSON.stringify(rejected, null, 2));
fs.writeFileSync(path.join(OUT, 'editorial_unreviewed.json'), JSON.stringify(unreviewed, null, 2));

log(`\n=== ADJUDICATION ===`);
log(`ACCEPTED ${accepted.length}   REJECTED ${rejected.length}   UNREVIEWED ${unreviewed.length}`);
for (const a of accepted) {
  log(`\n  ✓ ${a.org} [t${a.tier} ${a.category}] — ${a.editorial_pages_brand_tag} tag-ed / ${a.editorial_pages_text} text-ed / ${a.ad_pages_brand_tag} ad · ${a.editorial_issues} issue(s)`);
  log(`      ${a.citations.slice(0, 5).map((c) => `${c.issue} p.${c.page}[${c.spine_kind}]`).join(' · ')}`);
  log(`      ${a.reason}`);
}
for (const r of rejected) log(`\n  ✗ ${r.org} — ${r.verdict}: ${r.reason}`);
if (unreviewed.length) {
  log(`\n!! ${unreviewed.length} candidate(s) have magazine evidence but NO recorded verdict — they are never written. Adjudicate by hand and add to VERDICTS:`);
  for (const u of unreviewed) log(`   ? ${u.org} [t${u.tier} ${u.category}] tag-ed ${u.editorial_pages_brand_tag} / text-ed ${u.editorial_pages_text} / ad ${u.ad_pages_brand_tag}`);
}

if (!APPLY) { log(`\nDRY RUN — nothing written. Re-run with --apply.`); process.exit(0); }

// ---------- write ----------
// The relationship asserted is SELF-BRAND: this org IS this house on the island — the same
// relationship the 2026-07-18 monobrand backfill asserted with authorization_level 'exclusive'.
// No new enum value is invented. Stockist rosters and shoot-location credits are NOT written
// here; see the report for the 'carries' level still pending an owner decision.
let wrote = 0;
for (const a of accepted) {
  const { error } = await db.from('organization_brands').insert({
    organization_id: a.org_id,
    brand_name: (a.brand_forms.sort((x, y) => y.length - x.length)[0]) || a.org,
    authorization_level: 'exclusive',
    metadata: {
      run: RUN,
      method: 'self_brand_editorial_adjudication',
      inference: 'org_is_the_house_named_in_lofficiel_editorial',
      verdict: a.verdict,
      adjudication: a.reason,
      ad_vs_editorial_authority: 'mag_spine_page_kinds (story spine) via mag_is_ad — NOT vision page_type',
      editorial_pages_brand_tag: a.editorial_pages_brand_tag,
      editorial_pages_text: a.editorial_pages_text,
      ad_pages: a.ad_pages_brand_tag,
      ad_citations: a.ad_citations,
      editorial_issues: a.editorial_issues,
      citations: a.citations,
      source: 'lofficiel_editorial',
      observed_at: new Date().toISOString(),
      trust: 'printed',
    },
  });
  if (error) log(`WRITE FAIL ${a.org}: ${error.message}`);
  else wrote++;
}
log(`\nwrote ${wrote} organization_brands rows`);
