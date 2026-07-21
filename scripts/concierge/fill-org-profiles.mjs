#!/usr/bin/env node
// Fill L'Officiel concierge org profiles from each business's OWN website.
//
// Doctrine (see AGENTS.md "FACTS ARE SACRED"):
//   - Nothing is generated. Every stored value is verbatim from the operator's site.
//   - Every datum carries (source, method, observed_at, trust).
//   - A fetched page is only evidence about an org if the page IDENTIFIES that org.
//     That is the entity gate below, and it is the load-bearing part of this script.
//   - Columns are filled only when empty. An existing value is never overwritten.
//
// Usage:
//   node scripts/concierge/fill-org-profiles.mjs <queue.json> [--apply] [--limit N]
// Queue rows come from concierge/classify-org-domains.mjs.

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
// Served columns leave this script through ONE door. The script's own entity
// gate (below) decides whether the PAGE belongs to the org and is unchanged;
// the guarded writer then decides whether the VALUE may be served. They are
// different questions and this script previously only ever asked the first —
// which is how BODY+SOUL ST BARTH took the wordmark of the Indonesian gambling
// site that seized its lapsed domain: every host-level signal still said
// "own_site", because a domain outlives its owner. The page BODY is what
// contradicts it, and the page body was being dropped at the write boundary.
// It is now carried there (`ev`) and handed to the gate as evidence.
import { guardedOrgWrite, pageEvidence, ADMITTED } from './_guarded_org_write.mjs';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const FC = process.env.FIRECRAWL_API_KEY;
const APPLY = process.argv.includes('--apply');
const CONC = Number(process.env.CONC || 5);
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

// Meta descriptions in the wild carry markup and entities; strip both so a profile never
// renders "<br>" at a reader. Also collapse the duplicated fragments some CMSs emit.
// Named entities are common in French copy (&eacute;, &agrave;) and pass straight through a
// numeric-only decoder, so "Découvrez" arrives as "D&eacute;couvrez" — unreadable on the
// profile AND invisible to every downstream text rule that matches real words.
const NAMED = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', laquo: '«', raquo: '»',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', auml: 'ä', aring: 'å',
  ccedil: 'ç', icirc: 'î', iuml: 'ï', iacute: 'í', ocirc: 'ô', ouml: 'ö', oacute: 'ó', ograve: 'ò',
  ugrave: 'ù', ucirc: 'û', uuml: 'ü', uacute: 'ú', ntilde: 'ñ', aacute: 'á', atilde: 'ã', otilde: 'õ',
  szlig: 'ß', oslash: 'ø', aelig: 'æ', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  mdash: '—', ndash: '–', deg: '°', euro: '€', pound: '£', bull: '•', middot: '·', trade: '™',
  reg: '®', copy: '©', times: '×', frac12: '½', sup2: '²', eth: 'ð', thorn: 'þ', yuml: 'ÿ' };

const clean = (s) => {
  if (typeof s !== 'string') return null;
  let t = s.replace(/<[^>]+>/g, ' ')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&([a-z][a-z0-9]{1,9});/gi, (m, n) => {
      const k = NAMED[n.toLowerCase()];
      return k !== undefined ? k : m;   // unknown entity stays verbatim rather than being mangled
    })
    // markdown emphasis/links survive the prose path and would render as literal ** on a
    // profile; keep the words, drop the syntax
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/\s+/g, ' ').replace(/\s*,\s*,/g, ',').trim();
  // "X, X" duplication from CMS meta fields
  const half = Math.floor(t.length / 2);
  if (t.length > 40 && t.slice(0, half).trim().replace(/[,\s]+$/, '') === t.slice(half).trim().replace(/^[,\s]+/, '')) {
    t = t.slice(0, half).trim().replace(/[,\s]+$/, '');
  }
  // "<truncated copy>, <full copy>" — the same sentence twice at different cut points, which
  // is what a page shipping description AND og:description with different limits produces.
  // Find where the text starts over and keep the fuller copy rather than a stutter.
  if (t.length > 80) {
    const probe = t.slice(0, 40);
    const at = t.indexOf(probe, 1);
    if (at > 0) {
      const head = t.slice(0, at).replace(/[\s,;.]+$/, '').trim();
      const tail = t.slice(at).trim();
      if (head.length >= 25 && tail.length >= 25) t = tail.length >= head.length ? tail : head;
    }
  }
  return t || null;
};
const decode = (s) => (s || '').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const fold = (s) => decode(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const compact = (s) => fold(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- extraction (deterministic; no model in the fact path) ----------

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const p = JSON.parse(m[1].trim());
      out.push(...(Array.isArray(p) ? p : p['@graph'] ? p['@graph'] : [p]));
    } catch { /* malformed ld+json is common in the wild; skip rather than guess */ }
  }
  return out;
}

const BIZ = /Organization|LocalBusiness|Store|Restaurant|Hotel|BarOrPub|CafeOrCoffeeShop|HealthAndBeauty|BeautySalon|DaySpa|LodgingBusiness|ClothingStore|JewelryStore|HomeAndConstruction|ProfessionalService|TravelAgency|RealEstateAgent/i;

// "BL" or "Saint-Barthélemy, 97133, BL" is true but says nothing — every org on this island
// shares it. An address that is only island+postcode+country locates nobody, so it is not
// an address. Reject rather than stamp a non-answer into an empty column.
const ADDR_BOILERPLATE = /saint[- ]?barth[eé]lemy|saint[- ]?barth|st[.\s-]?barth|97133|\bBL\b|\bFR\b|\bfrance\b|french west indies|antilles|caribbean|guadeloupe/gi;
function addressQuality(s) {
  if (!s) return null;
  const residue = s.replace(ADDR_BOILERPLATE, ' ').replace(/[\s,.\-—]+/g, ' ').trim();
  return residue.length >= 4 ? s : null;
}

function fromJsonLd(blocks) {
  const b = blocks.find((x) => BIZ.test([].concat(x?.['@type'] ?? []).join(',')));
  if (!b) return null;
  const a = b.address && typeof b.address === 'object' ? b.address : null;
  let hours = null;
  if (b.openingHours) hours = [].concat(b.openingHours);
  else if (Array.isArray(b.openingHoursSpecification)) {
    hours = b.openingHoursSpecification.map((s) => {
      const d = [].concat(s.dayOfWeek ?? []).map((x) => String(x).replace(/.*\//, '')).join(',');
      return s.opens && s.closes ? `${d} ${s.opens}-${s.closes}` : d;
    }).filter(Boolean);
  }
  // schema.org allows addressCountry/addressRegion to be a nested Country object; joining
  // it raw stamps "[object Object]" into the address. Flatten to its name/value.
  const flat = (v) => (v == null ? null : typeof v === 'string' ? v
    : typeof v === 'object' ? (v.name || v['@value'] || v.alternateName || null) : String(v));
  return {
    ld_type: [].concat(b['@type']).join(','),
    name: clean(b.name),
    description: clean(b.description),
    telephone: clean(flat(b.telephone)),
    email: clean(flat(b.email)),
    address: a ? addressQuality(clean([a.streetAddress, a.addressLocality, a.postalCode, a.addressCountry].map(flat).filter(Boolean).join(', ')))
               : addressQuality(clean(typeof b.address === 'string' ? b.address : null)),
    opening_hours: hours,
    price_range: clean(b.priceRange),
    menu: clean(typeof b.menu === 'string' ? b.menu : b.hasMenu),
    same_as: [].concat(b.sameAs ?? []).filter((x) => typeof x === 'string'),
    image: [].concat(b.image ?? []).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean),
  };
}

const metaOf = (html, keys) => {
  for (const k of keys) {
    const m = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${k}["'][^>]+content=["']([^"']*)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${k}["']`, 'i'));
    if (m && clean(m[1])) return clean(m[1]);
  }
  return null;
};

// Sites routinely ship description AND og:description with different truncations of the same
// sentence (stbarthsailor.com: og cut at "…the caress of the tro"). Firecrawl hands them
// back joined, which stamps a stuttering half-sentence onto the profile. Read every
// description meta off the raw HTML ourselves and keep the fullest complete one.
const truncated = (t) => /(\.\.\.|…)$/.test((t || '').trim());
function bestMetaDescription(html, fcValue) {
  const cands = [];
  const re = /<meta[^>]+(?:name|property)=["'](?:og:description|twitter:description|description)["'][^>]*>/gi;
  for (const tag of html.match(re) || []) {
    const c = tag.match(/content=["']([^"']*)["']/i);
    if (c && clean(c[1])) cands.push(clean(c[1]));
  }
  if (fcValue) cands.push(fcValue);
  if (!cands.length) return null;
  // a candidate that is a prefix of a longer one is that one, cut short — never prefer it
  const kept = cands.filter((c) => !cands.some((o) => o !== c && o.length > c.length && o.startsWith(c.slice(0, Math.min(c.length, 60)))));
  const pool = kept.length ? kept : cands;
  const whole = pool.filter((c) => !truncated(c));
  return (whole.length ? whole : pool).sort((a, b) => b.length - a.length)[0];
}

// Text that is never the operator describing their business.
const NOISE = /cookie|consent|javascript|newsletter|subscribe|s'inscrire|©|all rights reserved|tous droits|privacy|politique de confidentialit|mentions l|en cochant|j'accepte|select your|choose your country|would you like to update|add to (cart|bag)|panier|sign ?up|log ?in|votre adresse e-?mail|lorem ipsum/i;

function proseCandidates(md) {
  if (!md) return null;
  const out = [];
  for (const raw of (md || '').split('\n')) {
    const l = clean(raw);
    if (!l || l.length < 90 || l.length > 900) continue;
    if (/^[#>|\-*![]/.test(l)) continue;
    if (NOISE.test(l)) continue;
    if ((l.match(/\]\(/g) || []).length > 1) continue;
    if ((l.match(/\|/g) || []).length > 2) continue;
    const letters = (l.match(/[A-Za-zÀ-ſ]/g) || []).length;
    if (letters / l.length < 0.7) continue;
    out.push(l.slice(0, 800));
    if (out.length >= 2) break;
  }
  return out.length ? out : null;
}

const SOCIAL = {
  instagram: /instagram\.com\/([A-Za-z0-9._]{2,})/i,
  facebook: /facebook\.com\/([A-Za-z0-9._-]{2,})/i,
  tiktok: /tiktok\.com\/@([A-Za-z0-9._]{2,})/i,
  youtube: /youtube\.com\/(?:@|channel\/|c\/)([A-Za-z0-9._-]{2,})/i,
  linkedin: /linkedin\.com\/(?:company|in)\/([A-Za-z0-9._-]{2,})/i,
};
const SOCIAL_JUNK = /^(p|people|pages|sharer|share|home|profile|tr|explore|login|policies|privacy|help|about)$/i;

function socials(links, sameAs) {
  const out = {};
  for (const u of [...(links || []), ...(sameAs || [])]) {
    if (/sharer|share\.php|intent\/|plugins|\/share/.test(String(u))) continue;
    for (const [k, re] of Object.entries(SOCIAL)) {
      const m = String(u).match(re);
      if (m && !out[k] && !SOCIAL_JUNK.test(m[1])) out[k] = m[1];
    }
  }
  return out;
}

function images(html, base, ogImage, ldImages) {
  const found = new Set();
  if (ogImage) found.add(ogImage);
  for (const i of ldImages || []) found.add(i);
  const re = /<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi;
  let m;
  while ((m = re.exec(html)) && found.size < 40) {
    let u = m[1];
    if (/^data:/.test(u)) continue;
    if (/sprite|favicon|icon-|pixel|spacer|1x1|placeholder|loader|blank|flag-|payment|visa|mastercard|paypal/i.test(u)) continue;
    try { u = new URL(u, base).href; } catch { continue; }
    found.add(u);
  }
  return [...found].slice(0, 12);
}

// ---------- the entity gate ----------

const GENERIC = /^(the|and|les|des|del|saint|st|barth|barths|barthelemy|sbh|sas|sarl|inc|ltd|llc|group|groupe|restaurant|restaurants|bar|cafe|hotel|villa|villas|boutique|shop|store|beach|club|jewelry|jewellery|bijouterie|chef|chefs|prive|events|event|architectures|architecture|architectes|design|studio|rental|rentals|real|estate|immobilier|agence|agency|services|service|company|maison|island|caraibes|france|paris|official|site|home|gustavia)$/;
const tokens = (s) => fold(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !GENERIC.test(t));
const SBH = /saint[- ]?barth|st[.\s-]?barth|\bsbh\b|gustavia|barthelemy|st bart|saint jean|lorient|flamands|colombier|corossol|toiny|97133/i;

// A worldwide site proves nothing about this island by listing it in a country picker.
// bardespres.com ("Franco-East Asian cuisine in Paris, London and Dubai") satisfied the
// island test purely from a 200-entry country <select> — and its global description would
// then have been attributed to the Gustavia door. Strip those regions before testing.
const COUNTRY_RUN = /(?:[A-ZÀ-Þ][A-Za-zÀ-ÿ.'()-]*(?:\s+[A-Za-zÀ-ÿ.'()-]+){0,3}\s*(?:-|–|,|\||\n)\s*){8,}/g;
const islandSignal = (md) => SBH.test(String(md || '').replace(COUNTRY_RUN, ' '));

// Is this org's identity anchored in the DOMAIN itself (not merely named on the page)?
// The about page of a domain only speaks for whoever owns that domain: sibarth.com/about
// describes Sibarth the agency, never "Villa Case des Lézards" listed on it.
function hostAnchored(orgName, finalUrl) {
  let hostc;
  try {
    hostc = compact(new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, '').replace(/\.(com|fr|net|org|co|sb|eu|io|shop|store)$/, ''));
  } catch { return false; }
  const on = tokens(orgName);
  const namec = compact(orgName);
  return on.some((t) => hostc.includes(compact(t)))
    || (!on.length && namec.length >= 6 && (hostc.includes(namec) || namec.includes(hostc)));
}

function entityGate(orgName, title, ldName, finalUrl, md) {
  const host = new URL(finalUrl).hostname.toLowerCase();
  const hostc = compact(host.replace(/^www\./, '').replace(/\.(com|fr|net|org|co|sb|eu|io|shop|store)$/, ''));
  const on = tokens(orgName);
  const titleHay = ` ${fold(title || '').toLowerCase()} ${fold(ldName || '').toLowerCase()} `;
  const titlec = compact(titleHay);
  const titleHits = on.filter((t) => titleHay.includes(t));
  // Some orgs are named entirely from generic words ("VILLA CHEF ST-BARTH"), leaving no
  // distinctive token at all. Falling through would fail every such org, so compare the
  // whole compacted name against the host/title instead.
  const namec = compact(orgName);
  const titleMatch = (on.length ? (titleHits.length / on.length >= 0.5 || titleHits.length >= 2) : false)
    || on.some((t) => titlec.includes(compact(t)))
    || (!on.length && namec.length >= 6 && titlec.includes(namec));
  const domainMatch = on.some((t) => hostc.includes(compact(t)))
    || (!on.length && namec.length >= 6 && (hostc.includes(namec) || namec.includes(hostc)));
  const sbh = islandSignal(md);

  if (!domainMatch && !titleMatch && !sbh) return { verdict: 'brand_global', reason: 'page identifies a different brand and states no island presence' };
  if (!domainMatch && !titleMatch) return { verdict: 'mismatch', reason: 'page is about St Barth but does not identify this org' };
  if (titleMatch && !sbh) return { verdict: 'brand_global', reason: 'page names the org but is the worldwide brand site, not the island door' };
  if (domainMatch && !titleMatch && on.some((t) => hostc === compact(t))) return { verdict: 'own_site', reason: null };
  if (domainMatch && !titleMatch) return { verdict: 'name_drift', reason: `own domain but page presents as "${title}" — possible rebrand or redirect` };
  return { verdict: 'own_site', reason: null };
}

// ---------- fetch ----------

// Timeouts are tunable because the slow-site tail is a fetch failure, not a business
// that has no site. Raising the ceiling and dropping CONC recovers those rows honestly.
const FC_TIMEOUT = Number(process.env.FC_TIMEOUT || 90000);
const FC_WAIT = Number(process.env.FC_WAIT || 4000);
// A transport failure is OUR failure, not the operator's. Retry the recoverable classes
// once with a longer ceiling before we ever record "unreachable" against a business.
const RETRYABLE = /timed out|timeout|All scraping engines failed|ERR_TUNNEL|ERR_CONNECTION|ECONNRESET|socket hang up|http 5\d\d|rate limit|429/i;

async function scrapeOnce(url, timeout, waitFor) {
  const r = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown', 'rawHtml', 'links'], onlyMainContent: false, timeout, waitFor }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.success) throw new Error(j?.error || `http ${r.status}`);
  return j.data || {};
}

async function scrape(url) {
  try {
    return await scrapeOnce(url, FC_TIMEOUT, FC_WAIT);
  } catch (e) {
    const msg = String(e.message || e);
    if (!RETRYABLE.test(msg)) throw e;           // DNS/404 will not improve on a retry
    await new Promise((r) => setTimeout(r, 3000));
    return await scrapeOnce(url, Math.round(FC_TIMEOUT * 1.8), FC_WAIT + 3000);
  }
}

// When a verified own-site homepage carries no self-description, the statement is usually
// one click away on the about page. Same domain = same entity, so the gate already held.
const ABOUT_RE = /(about|a-?propos|qui-sommes|qui-nous|notre-histoire|our-story|the-house|notre-maison|concept|presentation|présentation|nous-connaitre|la-maison|histoire)(\/|\.|$|\?)/i;

function aboutLink(links, finalUrl) {
  let host;
  try { host = new URL(finalUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
  const seen = new Set();
  for (const raw of links || []) {
    let u;
    try { u = new URL(String(raw), finalUrl); } catch { continue; }
    if (u.hostname.replace(/^www\./, '').toLowerCase() !== host) continue;   // same entity only
    if (!ABOUT_RE.test(u.pathname)) continue;
    if (/blog|news|press|career|job|privacy|cookie|legal|mentions/i.test(u.pathname)) continue;
    const href = u.href.split('#')[0];
    if (seen.has(href)) continue;
    seen.add(href);
    return href;
  }
  return null;
}

const DAY = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun', Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };
const readableHours = (arr) => arr.map((h) => {
  const m = String(h).match(/^(.+?)\s+(\d{1,2}:\d{2})(?::\d{2})?-(\d{1,2}:\d{2})(?::\d{2})?$/);
  if (!m) return String(h);
  const days = m[1].split(',').map((d) => DAY[d.trim()] || d.trim());
  const label = days.length === 7 ? 'Every day' : days.length > 2 ? `${days[0]}–${days[days.length - 1]}` : days.join(', ');
  return `${label} ${m[2]}–${m[3]}`;
});

// A description must actually SAY something about the business. "Easy & Fun Ride" (the name
// again) and "Découvrez le site internet de notre cabinet" (a nav instruction) are verbatim
// and true and still tell a reader nothing. A null is honest; a non-answer is clutter.
const BOILERPLATE = /^(d[ée]couvrez (le |notre )?(site|nouveau site)|bienvenue( sur)?|welcome( to)?|home ?page|site (officiel|internet|web)|official (web)?site|accueil|coming soon|page d'accueil)\b/i;
function saysSomething(text, orgName) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 25) return false;                       // a fragment, not a statement
  if (BOILERPLATE.test(t)) return false;
  const words = t.split(/\s+/).filter((w) => /[A-Za-zÀ-ſ]/.test(w));
  if (words.length < 5) return false;
  // strip the org's own name; if almost nothing survives it is a restatement of the name
  const nameWords = new Set(fold(orgName || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const residue = words.filter((w) => !nameWords.has(fold(w).toLowerCase().replace(/[^a-z0-9]/g, '')));
  return residue.length >= 4;
}

// A multi-city group's homepage passes the entity gate legitimately (bardespres.com really
// does have an island outpost, linked in its nav) — but the homepage's own description
// places the business "in Saint-Germain, Mayfair, or DIFC". Attributing that to the Gustavia
// door would be a clean-looking lie. If the text locates the business elsewhere and never
// names this island, it is not a description OF THIS DOOR.
const ELSEWHERE = /\b(paris|london|londres|dubai|dubaï|milano|milan|new york|miami|ibiza|mykonos|saint-?tropez|st\.? tropez|courchevel|geneva|gen[eè]ve|monaco|madrid|barcelona|roma|rome|tokyo|singapore|hong kong|los angeles|beverly hills|las vegas|shanghai|moscow|abu dhabi|doha|amsterdam|berlin|munich|zurich|vienna|lisbon|athens|istanbul|marbella|cannes|nice|lyon|bordeaux|marseille|deauville|biarritz|meg[eè]ve|chamonix|aspen|hamptons|palm beach|bal harbour|difc|mayfair|saint-?germain)\b/i;
const NAMES_ISLAND = /saint[- ]?barth|st[.\s-]?barth|gustavia|barth[eé]lemy|st bart|saint[- ]jean|lorient|flamands|colombier|corossol|toiny|97133|salines|marigot|shell beach|ouanalao|caribbean|cara[iï]bes|antilles|west indies/i;
const describesThisDoor = (text) => !(ELSEWHERE.test(text || '') && !NAMES_ISLAND.test(text || ''));

function pickDescription(ld, metaDesc, prose) {
  if (ld?.description) return { text: ld.description, basis: 'jsonld', trust: 'site_structured', confidence: 0.9 };
  // a meta description cut off mid-sentence is not a statement; prefer real prose
  if (metaDesc && !truncated(metaDesc)) return { text: metaDesc, basis: 'meta_description', trust: 'site_meta', confidence: 0.75 };
  if (prose?.length) return { text: prose[0], basis: 'page_prose', trust: 'site_prose', confidence: 0.6 };
  if (metaDesc) return { text: metaDesc, basis: 'meta_description_truncated', trust: 'site_meta', confidence: 0.5 };
  return null;
}

// ---------- provenance backfill ----------
// Every org already swept carries its full source DNA inside metadata.site, but the
// queryable provenance columns were never populated, so the profile could not SHOW where
// its facts came from. This projects the existing evidence into those columns. It fetches
// nothing and asserts nothing new — the observed_at is the original observation's.
//   node fill-org-profiles.mjs --provenance-backfill [--apply]
if (process.argv.includes('--provenance-backfill')) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('organizations')
      .select('id, name, metadata, enrichment_sources, data_signals, last_enriched_at')
      .eq('metadata->>project', 'lofficiel-concierge').not('metadata->site', 'is', null)
      .order('id').range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  let n = 0;
  const byStatus = {};
  for (const o of all) {
    const s = o.metadata.site;
    const v = s.entity_gate?.verdict;
    const f = s.facts || {};
    let host = null;
    try { host = new URL(s.final_url || s.source_url).hostname.replace(/^www\./, ''); } catch { /* unreachable rows */ }
    const status = v === 'own_site' ? 'site_verified' : v === 'unreachable' ? 'site_unreachable'
      : v === 'dead' ? 'site_dead' : `site_held_${v}`;
    byStatus[status] = (byStatus[status] || 0) + 1;
    const upd = {
      enrichment_sources: [...new Set([...(o.enrichment_sources || []), host ? `own_website:${host}` : 'own_website'])],
      last_enriched_at: s.observed_at,
      enrichment_status: status,
      data_signals: {
        ...(o.data_signals || {}),
        site: {
          verdict: v, source_url: s.final_url || s.source_url, observed_at: s.observed_at,
          method: s.extraction_method, trust: s.trust, confidence: s.confidence,
          description_basis: f.description_basis ?? null,
          description_source_url: s.description_source_url ?? null,
          has: {
            description: !!f.description_verbatim, phone: !!f.telephone, address: !!f.address,
            email: !!f.email, hours: !!(f.hours && f.hours.length), socials: !!f.socials,
            images: !!(f.image_urls && f.image_urls.length),
          },
          conflicts: s.conflicts?.length ? s.conflicts.map((c) => c.field) : null,
        },
      },
    };
    if (APPLY) {
      const { error } = await db.from('organizations').update(upd).eq('id', o.id);
      if (error) { console.error('WRITE FAIL', o.name, error.message); continue; }
    }
    n++;
  }
  console.error(`provenance ${APPLY ? 'written to' : 'would be written to'} ${n}/${all.length} orgs carrying a site block`);
  console.error(JSON.stringify(byStatus, null, 2));
  process.exit(0);
}

// ---------- run ----------

const queue = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).slice(0, LIMIT);
const stats = {};
const bump = (tier, k) => { (stats[tier] ??= { fetched: 0, own_site: 0, held: 0, desc: 0, about_hop: 0, desc_no_substance: 0, desc_wrong_door: 0, hours: 0, phone: 0, email: 0, addr: 0, social: 0, images: 0, errors: 0 })[k]++; };
const results = [];
const allConflicts = [];
const NO_ABOUT = process.argv.includes('--no-about');

async function handle(job) {
  const tier = job.tier;
  const targets = [{ id: job.id, name: job.name, slug: job.slug }, ...(job.also || [])];
  let d;
  try { d = await scrape(job.website); } catch (e) {
    bump(tier, 'errors');
    const block = { source_url: job.website, observed_at: new Date().toISOString(), extraction_method: 'firecrawl', entity_gate: { verdict: 'unreachable', reason: String(e.message || e).slice(0, 200) }, facts: null, trust: null, confidence: 1.0 };
    // An unreachable site has no body to judge — the gate is told so rather
    // than handed an empty string that would read as "the page named nobody".
    for (const t of targets) await writeOrg(t, block, null, null, null, null);
    results.push({ ...job, verdict: 'unreachable' });
    return;
  }
  bump(tier, 'fetched');

  const html = d.rawHtml || '';
  const md = d.markdown || '';
  const finalUrl = d.metadata?.sourceURL || d.metadata?.url || job.website;
  const status = d.metadata?.statusCode ?? null;
  const title = clean(d.metadata?.title || metaOf(html, ['og:title']));
  const ld = fromJsonLd(jsonLdBlocks(html));
  const observed_at = new Date().toISOString();

  const dead = (status && status >= 400)
    || /403 forbidden|404 not found|domain (is )?for sale|this domain|parked|under construction|site en construction|coming soon|account suspended/i.test(`${title || ''} ${md.slice(0, 600)}`);

  // Second hop, fetched at most once per site and only when the homepage said nothing about
  // the business. Guarded to the SAME hostname, so the homepage's entity verdict still holds.
  let about = null;
  const homeDesc = pickDescription(ld, bestMetaDescription(html, clean(d.metadata?.description)), proseCandidates(md));
  // only hop when at least one target OWNS this domain — otherwise the about page is a
  // different entity's self-description and attributing it here would be a fabrication
  const anyOwn = !dead && targets.some((t) => entityGate(t.name, title, ld?.name, finalUrl, md).verdict === 'own_site'
    && hostAnchored(t.name, finalUrl));
  if (!homeDesc?.text && anyOwn && !NO_ABOUT) {
    const link = aboutLink(d.links, finalUrl);
    if (link) {
      try {
        const a = await scrape(link);
        const aHtml = a.rawHtml || '';
        const aLd = fromJsonLd(jsonLdBlocks(aHtml));
        const aDesc = pickDescription(aLd, bestMetaDescription(aHtml, clean(a.metadata?.description)), proseCandidates(a.markdown || ''));
        if (aDesc?.text) about = { url: a.metadata?.sourceURL || link, desc: aDesc, ld: aLd };
      } catch { /* the about page is a bonus; its failure must not lose the homepage result */ }
    }
  }

  for (const t of targets) {
    const gate = dead
      ? { verdict: 'dead', reason: `site returned HTTP ${status ?? '?'} or is a parked/placeholder page` }
      : entityGate(t.name, title, ld?.name, finalUrl, md);

    const own = gate.verdict === 'own_site';
    // the about page is only this org's statement when this org owns the domain
    const useAbout = about && hostAnchored(t.name, finalUrl);
    const cand = own ? (homeDesc || (useAbout ? { ...about.desc, basis: `${about.desc.basis}@about` } : null)) : null;
    // verbatim is necessary but not sufficient — it must say something about THIS business
    const desc = cand && saysSomething(cand.text, t.name) && describesThisDoor(cand.text) ? cand : null;
    if (cand && !desc) bump(tier, saysSomething(cand.text, t.name) ? 'desc_wrong_door' : 'desc_no_substance');
    const descUrl = desc && !homeDesc && useAbout ? about.url : null;
    if (descUrl) bump(tier, 'about_hop');
    const soc = own ? socials(d.links, ld?.same_as) : {};
    const imgs = own ? images(html, finalUrl, metaOf(html, ['og:image', 'twitter:image']), ld?.image) : [];

    const block = {
      source_url: job.website,
      final_url: finalUrl,
      observed_at,
      extraction_method: 'firecrawl+jsonld+meta',
      rank_tier: tier,
      entity_gate: { verdict: gate.verdict, reason: gate.reason, mentions_stbarth: islandSignal(md), mentions_stbarth_raw: SBH.test(md) },
      description_source_url: descUrl,
      facts: own ? {
        description_verbatim: desc?.text ?? null,
        description_basis: desc?.basis ?? null,
        page_title: title,
        telephone: ld?.telephone ?? about?.ld?.telephone ?? null,
        email: ld?.email ?? about?.ld?.email ?? null,
        address: ld?.address ?? about?.ld?.address ?? null,
        hours: ld?.opening_hours?.length ? ld.opening_hours : (about?.ld?.opening_hours?.length ? about.ld.opening_hours : null),
        price_range: ld?.price_range ?? null,
        menu_url: ld?.menu ?? null,
        socials: Object.keys(soc).length ? soc : null,
        image_urls: imgs.length ? imgs : null,
        ld_type: ld?.ld_type ?? null,
      } : null,
      trust: desc?.trust ?? null,
      confidence: desc?.confidence ?? (gate.verdict === 'dead' ? 1.0 : 0.3),
    };

    if (own) {
      bump(tier, 'own_site');
      if (desc?.text) bump(tier, 'desc');
      if (ld?.opening_hours?.length) bump(tier, 'hours');
      if (ld?.telephone) bump(tier, 'phone');
      if (ld?.email) bump(tier, 'email');
      if (ld?.address) bump(tier, 'addr');
      if (Object.keys(soc).length) bump(tier, 'social');
      if (imgs.length) bump(tier, 'images');
    } else bump(tier, 'held');

    // the about page is the same entity, so its structured data is usable where the
    // homepage had none — but the homepage always wins when both speak.
    const ldEff = own ? {
      ...(about?.ld || {}), ...(ld || {}),
      opening_hours: ld?.opening_hours?.length ? ld.opening_hours : about?.ld?.opening_hours,
      email: ld?.email || about?.ld?.email,
    } : null;

    results.push({ id: t.id, name: t.name, tier, verdict: gate.verdict, website: job.website, description_source_url: descUrl, description: desc?.text ?? null });
    // Always adjudicate, write only under --apply. The dry run is now
    // informative rather than silent: it reports what WOULD be admitted and
    // what would be held, which is the only way to see a gate's effect before
    // trusting it with the column. No CLI flag changed; nothing writes without
    // --apply, inside this function or inside the writer.
    // Only the page text is handed over. `island` is deliberately NOT supplied:
    // this script's `islandSignal` is a BOOLEAN (SBH.test), while the gate's
    // `evidence.island` is a SIGNAL STRING ('island_phone' | 'island_postcode' |
    // 'island_repeated' | …). Passing the boolean would make islandSufficient()
    // see `true`, which is !== 'island_repeated' and therefore satisfies the
    // island requirement for ANY page merely mentioning St Barth — reopening the
    // Saint-Barthélemy-de-Bellegarde hole this gate exists to close. Letting
    // entityGate call islandPresence(md, host) itself is both correct and the
    // single source of truth. A real value attached to the wrong question is the
    // defect class here; it does not stop being one because I am the one wiring it.
    const c = await writeOrg(t, block, own ? desc : null, ldEff, own ? soc : null, { text: md });
    if (c?.length) allConflicts.push(...c.map((x) => ({ org: t.name, id: t.id, ...x })));
  }
}

// A stored value and a site value that disagree is a FINDING, not a write. The stored
// value stays; the disagreement is carried on the profile so it can be adjudicated.
const digitsOf = (s) => String(s || '').replace(/\D/g, '');
const normOf = (s) => fold(String(s || '')).toLowerCase().replace(/[^a-z0-9]/g, '');

function disagrees(field, stored, site) {
  if (!stored || !site) return false;
  if (field === 'phone') {
    const a = digitsOf(site), b = digitsOf(stored);
    if (a.length < 6 || b.length < 6) return false;
    // local vs +590 international form of the same line is the same fact
    return !a.endsWith(b.slice(-8)) && !b.endsWith(a.slice(-8));
  }
  const a = normOf(site), b = normOf(stored);
  if (!a || !b) return false;
  // one being a fuller rendering of the other (added commune/postcode/country) is not a conflict
  return !a.includes(b) && !b.includes(a);
}

async function writeOrg(t, block, desc, ld, soc, ev = null) {
  const { data: cur, error } = await db.from('organizations')
    .select('id, name, metadata, description, hours_of_operation, email, phone, address, social_links, enrichment_sources, data_signals, latitude, longitude, city, country')
    .eq('id', t.id).single();
  if (error) { console.error('READ FAIL', t.name, error.message); return; }

  const f = block.facts || {};
  const conflicts = [];
  for (const [field, storedVal, siteVal] of [
    ['phone', cur.phone, f.telephone],
    ['address', cur.address, f.address],
    ['email', cur.email, f.email],
    ['description', cur.description, f.description_verbatim],
  ]) {
    if (field === 'description') continue;   // prose never "conflicts" — it is a different statement
    if (disagrees(field, storedVal, siteVal)) {
      conflicts.push({ field, stored: storedVal, site: siteVal, source_url: block.final_url, observed_at: block.observed_at });
    }
  }
  if (conflicts.length) block.conflicts = conflicts;

  // ── SERVED FACT COLUMNS — offered to the gate, never written here ────────
  // fill-only-empty is unchanged: a candidate is only ever OFFERED for a column
  // that stands empty. What changed is that offering is no longer writing.
  const prov = {
    source: 'own_website',
    source_url: block.final_url || block.source_url,
    observed_at: block.observed_at,
    method: block.extraction_method,
    trust: block.trust || 'site_verbatim',
  };
  const offered = [];
  if (desc?.text && !cur.description) offered.push({ ...prov, field: 'description', value: desc.text, trust: desc.trust || prov.trust });
  if (ld?.opening_hours?.length && !Object.keys(cur.hours_of_operation || {}).length) {
    offered.push({
      ...prov, field: 'hours_of_operation',
      value: {
        source: 'site_jsonld', trust: 'site_structured', source_url: block.final_url,
        observed_at: block.observed_at, raw: ld.opening_hours, readable: readableHours(ld.opening_hours),
      },
    });
  }
  if (ld?.email && !cur.email) offered.push({ ...prov, field: 'email', value: ld.email, trust: 'site_structured' });
  if (f.telephone && !cur.phone) offered.push({ ...prov, field: 'phone', value: f.telephone, trust: 'site_structured' });
  if (f.address && !cur.address) offered.push({ ...prov, field: 'address', value: f.address, trust: 'site_structured' });
  if (soc && Object.keys(soc).length) {
    // social_links MERGES rather than replaces, so the incoming value is the
    // merged object — the gate must judge what will actually stand in the
    // column, not the fragment that produced it.
    offered.push({
      ...prov, field: 'social_links', trust: 'site_structured',
      value: { ...(cur.social_links || {}), ...soc, _source: 'own_website', _observed_at: block.observed_at },
      supersede: !!(cur.social_links && Object.keys(cur.social_links).length),
    });
  }

  const gate = await guardedOrgWrite({
    org: cur,
    fields: offered,
    // The evidence IS the page. `ev.text` is the markdown this run fetched —
    // the only thing that can contradict a host that still carries the name.
    evidence: pageEvidence({
      url: block.final_url || block.source_url,
      text: ev?.text || null,
      island: ev?.island ?? null,
      phone_on_page: !!f.telephone,
      address: f.address || null,
    }),
    apply: APPLY,
  });
  const admittedDesc = ADMITTED(gate.decisions.description);

  // ── BOOKKEEPING COLUMNS — provenance, not served facts. Written here. ────
  const upd = { metadata: { ...(cur.metadata || {}), site: block } };
  // The citation may only describe the text actually IN the column. When a description
  // already stood (from an earlier witness) the site's own copy is not adopted, so stamping
  // description_basis/source_url here would credit this page for someone else's sentence —
  // a false citation, which is the same class of harm as a fabricated value.
  // A description the GATE held is not in the column either, and citing it would
  // be the identical false citation — so adoption now requires admission.
  const adopted = !!desc?.text && admittedDesc && normOf(cur.description || desc.text) === normOf(desc.text);
  block.write_gate = {
    offered: offered.map((o) => o.field),
    admitted: gate.admitted,
    held: Object.fromEntries(Object.entries(gate.decisions)
      .filter(([, r]) => !ADMITTED(r) && r.action !== 'skipped')
      .map(([k, r]) => [k, { action: r.action, severity: r.severity, reason: String(r.reason || '').slice(0, 400) }])),
  };

  // provenance columns — every datum carries (source, method, observed_at, trust)
  const verdict = block.entity_gate?.verdict;
  let host = null;
  try { host = new URL(block.final_url || block.source_url).hostname.replace(/^www\./, ''); } catch { /* unreachable rows have no final url */ }
  const srcTag = host ? `own_website:${host}` : 'own_website';
  upd.enrichment_sources = [...new Set([...(cur.enrichment_sources || []), srcTag])];
  upd.last_enriched_at = block.observed_at;
  upd.enrichment_status = verdict === 'own_site' ? 'site_verified'
    : verdict === 'unreachable' ? 'site_unreachable'
    : verdict === 'dead' ? 'site_dead'
    : `site_held_${verdict}`;
  upd.data_signals = {
    ...(cur.data_signals || {}),
    site: {
      // an adjudication flag raised by a reviewer outlives any single re-fetch — a later
      // sweep must not silently clear a standing work order by rewriting this key
      ...(cur.data_signals?.site?.entity_review ? { entity_review: cur.data_signals.site.entity_review } : {}),
      verdict,
      source_url: block.final_url || block.source_url,
      observed_at: block.observed_at,
      method: block.extraction_method,
      trust: block.trust,
      confidence: block.confidence,
      // only the text actually standing in the column may carry this citation
      description_basis: adopted ? (f.description_basis ?? null) : null,
      description_source_url: adopted ? (block.description_source_url ?? null) : null,
      ...(desc?.text && !adopted ? { description_citation: {
        status: 'stored_description_not_from_this_source',
        site_text: desc.text, cited_url: block.final_url || block.source_url, checked_at: block.observed_at,
      } } : {}),
      has: {
        description: !!f.description_verbatim, phone: !!f.telephone, address: !!f.address,
        email: !!f.email, hours: !!(f.hours && f.hours.length), socials: !!f.socials,
        images: !!(f.image_urls && f.image_urls.length),
      },
      conflicts: conflicts.length ? conflicts.map((c) => c.field) : null,
    },
  };

  // The sidecar goes through the SAME call, with no fields, purely so the gate's
  // quarantine/quality records are merged into this metadata object instead of
  // being clobbered by it. writeField wrote them from the row IT loaded; this
  // update was built from a read taken before that. Merging is the only way both
  // survive, and losing a quarantine record would lose the held value — the one
  // thing quarantine exists to prevent.
  const side = await guardedOrgWrite({ org: cur, fields: [], sidecar: upd, apply: APPLY, evidence: null, mergeDecisions: gate.decisions });
  if (side.sidecar_error) console.error('WRITE FAIL', t.name, side.sidecar_error);
  if (Object.keys(gate.decisions).some((k) => !ADMITTED(gate.decisions[k]) && gate.decisions[k].action !== 'skipped')) {
    for (const [fld, r] of Object.entries(gate.decisions)) {
      if (ADMITTED(r) || r.action === 'skipped') continue;
      console.error(`   HELD ${fld.padEnd(18)} ${String(t.name).slice(0, 28).padEnd(30)} [${r.action}/${r.severity}] ${String(r.reason).slice(0, 140)}`);
    }
  }
  return conflicts;
}

let done = 0;
const q = [...queue];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (q.length) {
    const job = q.shift();
    await handle(job);
    if (++done % 25 === 0) console.error(`[${done}/${queue.length}]`);
  }
}));

fs.writeFileSync(process.argv[2].replace(/\.json$/, '_results.json'), JSON.stringify(results, null, 2));
console.error('\n=== YIELD BY RANK TIER ===');
for (const [tier, s] of Object.entries(stats)) {
  const pct = (n) => (s.own_site ? `${Math.round((n / s.own_site) * 100)}%` : '—');
  console.error(`\n${tier}: fetched ${s.fetched}, own_site ${s.own_site}, held ${s.held}, unreachable ${s.errors}`);
  console.error(`   of own_site → desc ${s.desc} (${pct(s.desc)}, ${s.about_hop} via about page) · hours ${s.hours} (${pct(s.hours)}) · phone ${s.phone} (${pct(s.phone)}) · addr ${s.addr} (${pct(s.addr)}) · social ${s.social} (${pct(s.social)}) · images ${s.images} (${pct(s.images)})`);
}
const verdicts = {};
for (const r of results) verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
console.error('\nverdicts across all org rows:', JSON.stringify(verdicts));

// Conflicts are the product, not an error log — a site disagreeing with a stored value is
// exactly what an authenticating system exists to surface. Nothing was overwritten.
if (allConflicts.length) {
  const cpath = process.argv[2].replace(/\.json$/, '_conflicts.json');
  fs.writeFileSync(cpath, JSON.stringify(allConflicts, null, 2));
  console.error(`\n=== ${allConflicts.length} CONFLICTS RECORDED (stored value kept, site value carried) → ${cpath} ===`);
  for (const c of allConflicts.slice(0, 25)) {
    console.error(`  ${c.field.padEnd(8)} ${String(c.org).slice(0, 30).padEnd(32)} stored="${String(c.stored).slice(0, 34)}" | site="${String(c.site).slice(0, 34)}"`);
  }
}
