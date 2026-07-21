// Shared entity-gate primitives for the concierge org pipeline.
//
// ONE source of truth for "does this page belong to this org", used by
// discover-org-websites.mjs (asserting a URL) and audit-discovered-websites.mjs
// (re-adjudicating what was asserted). They must never drift apart.
//
// Every rule below was written against a MEASURED false positive from a hand-check,
// noted inline. Do not relax one without a counter-example.

export const decode = (s) => (s || '').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
export const fold = (s) => decode(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
export const compact = (s) => fold(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const LEGAL = /\b(s\.?a\.?r\.?l\.?|sarl|s\.?a\.?s\.?u?|sas|eurl|snc|sci|scp|selarl|e\.?i\.?r\.?l\.?|ets|etablissements?|societe)\b/gi;
export const stripLegal = (s) => decode(s).replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();

// Words that identify a CATEGORY, never a business. A domain matching only these is
// matching the trade, not the trader. (aeroport.fr landed on the St Barth airport;
// time.is landed on TIME SAINT-BARTH.)
export const GENERIC = /^(the|and|les|des|del|saint|st|barth|barths|barthelemy|sbh|sas|sarl|inc|ltd|llc|group|groupe|restaurant|restaurants|bar|cafe|hotel|villa|villas|boutique|shop|store|beach|club|jewelry|jewellery|bijouterie|chef|chefs|prive|events|event|architectures|architecture|architectes|design|studio|rental|rentals|real|estate|immobilier|agence|agency|services|service|company|maison|island|caraibes|caraibe|caribbean|management|france|paris|official|site|home|gustavia|97133|aeroport|airport|time|jet|world|travel|tour|tours|guide|news|info|magazine|taxi|taxis|auto|autos|garage|pharmacie|pharmacy|medical|medecin|sante|health|hopital|hospital|ecole|school|eglise|church|mairie|poste|banque|bank|assurance|assurances|cadastre|meteo|marine|nautique|charpente|menuiserie|electricite|plomberie|piscine|jardin|jardinier|etancheite|entrepots|entrepot|nettoyage|transport|transports|location|locations|luxury|properties|property|international|national|federation|association|cabinet|centre|center|veterinaire|veterinary|clinique|clinic|neurologue|dentiste|docteur|massage|gardener|jardinier)$/;

export const tokens = (s) => fold(stripLegal(s)).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  .filter((t) => t.length >= 3 && !GENERIC.test(t));

export const SBH = /saint[- ]?barth|st[.\s-]?barth|\bsbh\b|barthelemy|barthélemy|st bart|\bsaint jean\b|lorient|flamands|colombier|corossol|toiny|gustavia|97133/i;
export const ISLAND_IN_HOST = /stbarth|st-barth|saintbarth|saint-barth|stbarts|st-barts|stbarthelemy|sbh|97133|fwi/i;

// A review site, directory or social network is a witness ABOUT an org, never its own door.
export const AGGREGATOR = /(^|\.)(tripadvisor|yelp|facebook|fb|instagram|twitter|x|linkedin|tiktok|youtube|pinterest|threads|whatsapp|wa\.me|google|goo\.gl|maps|waze|bing|duckduckgo|wikipedia|wikiwand|access\.sb|directory-saintbarth|teledom|pagesjaunes|118712|societe|verif|infogreffe|pappers|bodacc|annuaire-entreprises|manageo|kompass|europages|yellowpages|hotfrog|cybo|tuugo|opendi|zaubee|nicelocal|foursquare|restaurantguru|thefork|lafourchette|opentable|booking|expedia|airbnb|vrbo|tripsavvy|wanderlog|villaveo|gloobles|key-paradise|easemytrip|wimco|marriott|hotels|trivago|kayak|agoda|travelocity|yandex|apple|amazon|ebay|etsy|linktr|linktree|beacons|bit\.ly|issuu|calameo|scribd|glassdoor|indeed|crunchbase|zoominfo|dnb|opencorporates|trustpilot|sortlist|houzz|archdaily|behance|vimeo|soundcloud|spotify|medium|blogspot|wordpress\.com|wixsite|weebly|jimdo|godaddysites|business\.site|mappy|petitfute|routard|lonelyplanet|frenchcaribbean|sbhonline|st-barths|saint-barths|stbarthweekly|lessaintbarth|saintbarth-tourisme|enjoystbarth|barnes-stbarth|barnes-international|tourisme|comstbarth|lofficielstbarth|charpente|travaux-publics|lepharmacien|hopital|eglises|medecins-degarde|echecs|france-cadastre|aeroport|optical-center|meteofrance|sothebysrealty|croix-rouge|gouv|prefecture|impots|urssaf|legifrance|journal-officiel|leparisien|lefigaro|lemonde|francetv|guadeloupe|martinique)\./i;

export const isAggregator = (host) => AGGREGATOR.test(`.${host}.`);

// Worldwide houses whose .com serves the maison, never this island's door.
export const GLOBAL_MAISON = new Set(['dior', 'bulgari', 'longchamp', 'valentino', 'vilebrequin', 'hermes', 'chopard', 'prada', 'rolex', 'louisvuitton', 'chanel', 'gucci', 'cartier', 'richardmille', 'chromehearts', 'stuartweitzman', 'ralphlauren', 'eresparis', 'paindesucre', 'hertz', 'avis', 'europcar', 'iwc', 'omega', 'breitling', 'tagheuer', 'swatch', 'monoprix', 'carrefour', 'leclerc']);

// A directory/locator ENTRY, wherever it lives. Applied to every candidate — a national
// trade directory carries the trade's name in its own domain (charpente.net for
// D.R. CHARPENTE), so "the host carries the org name" does not exempt a page from this.
export const LOCATOR_PATH = /\/(boutiques?|stores?|store-locator|find-a-(store|retailer)|magasins?|shops?|dealers?|retailers?|stockists?|points?-de-vente|revendeurs?|locateanything\w*|annuaire[\w-]*|directory|listing|entreprise_localisation|delegation-territoriale[\w-]*|ficheclub[\w.]*|companies|for-sale|sales|sos|node|cadastre|poi|places?|things-to-do[\w-]*|guide-to-[\w-]*|where-to-buy|nos-magasins)\//i;

export const phoneKeys = (p) => {
  if (!p) return [];
  const out = new Set();
  for (const chunk of String(p).split(/[\/,;]|\bou\b/i)) {
    const d = chunk.replace(/\D/g, '');
    if (d.length >= 9) out.add(d.slice(-9));
  }
  return [...out];
};

// A single passing mention of "St Barth" is NOT island presence — a Rome swimwear brand
// listing a St Barth stockist trips it (measured on delfinaswim.com).
export function islandPresence(md, host) {
  if (ISLAND_IN_HOST.test(host)) return 'island_domain';
  if (/(?:\+\s?590|00\s?590|\b0590|\b0690)[\s.\-]?\d/.test(md)) return 'island_phone';
  if (/\b97133\b/.test(md)) return 'island_postcode';
  const hits = (md.match(new RegExp(SBH.source, 'gi')) || []).length;
  return hits >= 3 ? 'island_repeated' : null;
}

// Use the REGISTRABLE domain, not the full hostname: a subdomain must not dilute the
// match ("caraibe.orange.fr" is Orange's domain, and ORANGE CARAIBE owns it).
export const registrable = (host) => {
  const l = host.replace(/^www\./, '').toLowerCase().split('.');
  return l.length <= 2 ? l.join('.') : l.slice(-(/\.(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(host) ? 3 : 2)).join('.');
};
export const hostCore = (host) => compact(registrable(host).replace(/\.[a-z.]{2,12}$/, ''))
  .replace(/(stbarth|stbarts|saintbarth|stbarthelemy|sbh|97133|fwi)/g, '');
export const nameCore = (name) => compact(stripLegal(name).replace(/saint[- ]?barth\w*|st[.\s-]?barth\w*|\bsbh\b/gi, ''));

// Does the HOST itself carry this org's identity? Owning a domain is expensive; being
// named on a page is free. Each clause below is bounded by a measured false positive:
//   - nameCore >= 5 : "TIME SAINT-BARTH" -> time.is
//   - >=2 of >=2 tokens : "BOUZAT Xavier" -> xavierdavid.fr, "BRINSTER MARINE" -> jickymarine.com
//   - size similarity : "JET WORLD" -> jetsetworldtravel.com, "SAINT BARTH AGENCEMENT" -> caa-agencement.fr
//   - lone token >= 6 and not swamped : "LG STUDIO" -> bg-architectes.com
export function hostCarriesName(orgName, host, phoneOnPage = false) {
  const hc = hostCore(host);
  const nc = nameCore(orgName);
  const on = tokens(orgName);
  // stem match: "BRICE'S IN CHARGE" owns briceincharge.com — the plural must not defeat it
  const stem = (t) => { const c = compact(t); return c.length >= 6 ? c.slice(0, Math.max(5, c.length - 2)) : c; };
  const inHost = on.filter((t) => hc.includes(compact(t)) || hc.includes(stem(t)));
  const sim = (a, b) => (Math.min(a.length, b.length) / Math.max(a.length, b.length, 1));

  if (nc.length >= 5 && hc === nc) return 'host_is_name';
  // One name containing the other is weak on its own: "SAINT BARTH PRINT" vs
  // stbarthsartprints.com (an art-poster shop), "GREEN SMILE" vs greenstbarths.com (a
  // reforestation NGO), "CHILD IN PARADISE" vs saintbarthparadise.com (a villa agency) —
  // all measured false positives at sim 0.50-0.53. Demand a close match, UNLESS the page
  // carries the org's own phone number, which is independent proof of identity.
  // ...and the DISTINCTIVE part of the name must be the part that matched. "BERNARD VILLA
  // MANAGEMENT" vs stbarthvillamanagement.com (Shêraze Mathlouthi's agency) overlapped
  // entirely on the trade words; "bernard" appears nowhere in the host.
  if (nc.length >= 5 && (hc.includes(nc) || nc.includes(hc)) && sim(hc, nc) >= (phoneOnPage ? 0.5 : 0.65)
      && (on.length === 0 || inHost.length >= 1)) return 'host_contains_name';
  // Stem/lone-word clauses only apply when the business IS essentially that one word.
  // "GREEN SMILE" -> greenstbarths.com (a reforestation NGO) and "CHILD IN PARADISE" ->
  // saintbarthparadise.com (a villa agency) both matched on one common word out of two.
  if (on.length <= 1 && hc.length >= 3 && nc.startsWith(hc) && ISLAND_IN_HOST.test(host)) return 'host_is_name_stem_plus_island';
  // an org named with 2+ distinctive tokens must have 2+ of them in the host
  // a domain opening with a distinctive 8+ char business word is that business's domain
  const lead = on.length === 1 && compact(on[0]).length >= 8 && hc.startsWith(compact(on[0]));
  if (lead) return 'host_starts_with_name_token';
  if (on.length >= 2) {
    if (inHost.length >= 2 && sim(hc, nc) >= 0.55) return 'host_carries_two_name_tokens';
    return null;
  }
  if (inHost.length === 1) {
    const t = compact(inHost[0]);
    // a domain that BEGINS with the business word is that business's domain
    // (phenixmultiservice.net for PHENIX); one that merely contains it is not
    // (jetsetworldtravel.com for JET WORLD).
    if (t.length >= 6 && (hc.startsWith(t) || hc.startsWith(stem(t)))) return 'host_starts_with_name_token';
  }
  return null;
}

// Island presence by repetition alone is only trustworthy when the domain IS the business
// name — otherwise any travel page about the island clears it.
// MEASURED CLASS: mainland France has its own communes named Saint-Barthélemy
// (Saint-Barthélemy-de-Bellegarde, Dordogne). "BARTHOME" matched le-barthome.fr — a
// restaurant there — on repeated mentions of "Barthélemy" alone. Repetition of the island's
// NAME is therefore never island presence; only a contact that can only be the island is
// (a +590 number, the 97133 postcode, or the island in the org's own domain).
export function islandSufficient(island) {
  return !!island && island !== 'island_repeated';
}

// The distinctive identity of a name, generic trade words removed. "SAINT BARTH
// MENUISERIE" has NO distinctive core — which is exactly why it cannot vouch for sharing
// a domain with "S.P.I.M. MENUISERIE".
export const identityCore = (name) => tokens(name).map(compact).join('');

// Do these org names denote the same business? Used to tell a duplicate directory row
// ("BAR DE LOUBLI" / "BAR DE L'OUBLI" on bardeloubli.com — one business, two rows) from a
// portal serving many businesses (fredmanagement-stbarth.com across five companies).
export function sameBusiness(a, b) {
  const ca = identityCore(a), cb = identityCore(b);
  if (!ca || !cb) return false;
  return ca === cb || ca.includes(cb) || cb.includes(ca);
}

// The full discovery verdict for an already-fetched candidate.
export function adjudicate({ orgName, host, path, island, phoneOnPage }) {
  if (isAggregator(host)) return { verdict: 'aggregator', reason: 'review site / directory / social network' };
  if (GLOBAL_MAISON.has(hostCore(host))) return { verdict: 'global_maison', reason: 'worldwide brand site — cannot describe the island door' };
  if (LOCATOR_PATH.test(path || '/')) return { verdict: 'stockist_locator', reason: 'directory / dealer-locator entry — evidence about the org, not its own site' };
  const named = hostCarriesName(orgName, host, !!phoneOnPage);
  if (!named) return { verdict: 'weak_title_only', reason: 'host does not carry the org name — a page about an org is not that org\'s door' };
  if (!islandSufficient(island)) return { verdict: 'no_island_presence', reason: `island signal "${island || 'none'}" too weak for this domain` };
  return { verdict: 'own_site', reason: null, host_carries_name: named, phone_corroborated: !!phoneOnPage };
}
