// Prerendered /compare and /alternatives faces.
// Competitor claims are limited to phrases taken from pages fetched on 2026-11-23
// (America/Los_Angeles) and linked in the body. Nuke claims must appear in the
// repo files listed in NUKE_CLAIM_LOCKSTEP. Unsourced claims are omitted.

import { SITE, escapeHtml, type FacePage } from './discoveryFace';

function ldScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

function faqLd(url: string, name: string, description: string, faqs: { q: string; a: string }[]): unknown {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name,
        url,
        description,
        isPartOf: { '@type': 'WebSite', name: 'Nuke', url: SITE },
      },
      {
        '@type': 'FAQPage',
        url,
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };
}

const crumbs = (parts: { label: string; href: string }[]) =>
  `<nav>${parts.map((p) => `<a href="${escapeHtml(p.href)}">${escapeHtml(p.label)}</a>`).join(' · ')}</nav>`;

/** Calendar date of the fetches used to write these pages, in America/Los_Angeles. */
export const COMPARE_FETCHED_ON = '2026-11-23';

export type Citation = {
  id: string;
  href: string;
  title: string;
  fetchedOn: typeof COMPARE_FETCHED_ON;
  /** Phrases copied from the fetched page; the face may only lean on these. */
  phrases: string[];
};

export const CITATIONS: Citation[] = [
  {
    id: 'hagerty-method',
    href: 'https://www.hagerty.com/media/market-trends/hagerty-insider/how-the-hagerty-price-guide-is-made/',
    title: 'How the Hagerty Price Guide is made (Hagerty Media, 27 July 2023)',
    fetchedOn: COMPARE_FETCHED_ON,
    phrases: [
      'Hagerty Price Guide values that we publish online at Hagerty Valuation Tools',
      'a guide to collector car values in the North American market',
      'high-touch, human-centered process',
      'Some people assume it is an algorithm derived from insurance values. Others believe it is an average of auction sales.',
      'Auction results',
      'Peer-to-peer sales',
      'Asking prices',
      'Dealer and broker sales',
      'This is where being a large insurance provider comes in handy',
    ],
  },
  {
    id: 'hagerty-valuation-tool',
    href: 'https://www.hagerty.com/media/market-trends/valuation/how-much-is-your-classic-car-worth/',
    title: 'How much is your classic worth? Use the Hagerty Valuation Tool (Hagerty Media, 2 May 2019)',
    fetchedOn: COMPARE_FETCHED_ON,
    phrases: [
      'four different condition classifications for every rated vehicle',
    ],
  },
  {
    id: 'hagerty-insurance',
    href: 'https://www.hagerty.com/insurance/classic-car-insurance',
    title: 'Classic and collector car insurance (Hagerty)',
    fetchedOn: COMPARE_FETCHED_ON,
    phrases: [
      'Classic and collector car insurance',
      'Insurance services administered by Hagerty Insurance Agency, LLC',
    ],
  },
  {
    id: 'classic-about',
    href: 'https://www.classic.com/about',
    title: 'About us (CLASSIC.COM)',
    fetchedOn: COMPARE_FETCHED_ON,
    phrases: [
      'search engine and pricing database',
      'cars change hands at auctions, through dealers, and in private sales',
      'Find out what your car is worth or list it for sale',
      'Sales Platform',
      'Market Database',
    ],
  },
  {
    id: 'classic-cmb',
    href: 'https://support.classic.com/what-is-cmb-how-is-it-different-from-average-price',
    title: 'What is CMB? How is it Different from Average Price? (CLASSIC.COM Support)',
    fetchedOn: COMPARE_FETCHED_ON,
    phrases: [
      'CMB stands for CLASSIC.COM Market Benchmark',
      'Neither figure should be used as the exact value of a specific vehicle',
      'Average Price is the mean sale price for a group of sold listings',
      'placing greater weight on more recent transactions',
    ],
  },
  {
    id: 'classic-valuation',
    href: 'https://www.classic.com/garage/about',
    title: 'Valuation (CLASSIC.COM)',
    fetchedOn: COMPARE_FETCHED_ON,
    phrases: [
      'Values are updated every day based on sale prices from over 600 auctions and dealers around the world',
    ],
  },
  {
    id: 'bat-about',
    href: 'https://bringatrailer.com/about/',
    title: 'About BaT (Bring a Trailer)',
    fetchedOn: COMPARE_FETCHED_ON,
    phrases: [
      'Bring a Trailer is an online vehicle auction platform and enthusiast community',
      'All auction results are published in a comprehensive, searchable database that’s visible to everyone for all time',
      'We curate every vehicle that we list',
    ],
  },
  {
    id: 'bat-results',
    href: 'https://bringatrailer.com/auctions/results/',
    title: 'Auction Results (Bring a Trailer)',
    fetchedOn: COMPARE_FETCHED_ON,
    phrases: [
      'View 275,777 Completed Auctions',
    ],
  },
];

export const citation = (id: string): Citation => {
  const c = CITATIONS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown citation ${id}`);
  return c;
};

const ref = (id: string, label?: string) => {
  const c = citation(id);
  return `<a href="${escapeHtml(c.href)}">${escapeHtml(label ?? c.title)}</a>`;
};

export const NUKE_CLAIM_LOCKSTEP: { phrase: string; files: string[] }[] = [
  { phrase: 'Not a price guide', files: ['nuke_frontend/src/pages/About.tsx', 'nuke_frontend/src/lib/trustFaces.ts'] },
  { phrase: 'Not a marketplace', files: ['nuke_frontend/src/pages/About.tsx', 'nuke_frontend/src/lib/trustFaces.ts'] },
  { phrase: 'nothing is listed or sold', files: ['nuke_frontend/src/pages/About.tsx'] },
  { phrase: 'sensors, never sources', files: ['docs/POSITIONING.md', 'nuke_frontend/src/lib/trustFaces.ts'] },
  { phrase: 'Asking prices are not sales', files: ['supabase/functions/mcp-connector/advisor/tools.ts'] },
  { phrase: 'capped at 0.6', files: ['supabase/functions/mcp-connector/advisor/tools.ts', 'nuke_frontend/src/lib/trustFaces.ts'] },
  { phrase: 'valuation_by_ymm', files: ['nuke_frontend/src/lib/productFaces.ts'] },
  { phrase: 'Condition and equipment are not matched', files: ['nuke_frontend/src/lib/productFaces.ts', 'nuke_frontend/src/pages/Valuation.tsx'] },
  { phrase: 'evaluate_listing', files: ['supabase/functions/mcp-connector/advisor/tools.ts'] },
  { phrase: 'Bring a Trailer URLs only', files: ['nuke_frontend/src/lib/productFaces.ts'] },
  { phrase: 'market_sources_read', files: ['nuke_frontend/src/lib/trustFaces.ts'] },
  { phrase: '/evidence.md', files: ['nuke_frontend/src/lib/trustFaces.ts'] },
];

export const COMPARE_PATHS = [
  '/compare',
  '/alternatives',
  '/compare/nuke-vs-hagerty',
  '/compare/nuke-vs-classic-com',
  '/compare/nuke-vs-bat-results',
] as const;

export type CompareKind = 'index' | 'hagerty' | 'classic' | 'bat';

export function parseComparePath(pathname: string): CompareKind | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (path === '/compare' || path === '/alternatives') return 'index';
  if (path === '/compare/nuke-vs-hagerty') return 'hagerty';
  if (path === '/compare/nuke-vs-classic-com') return 'classic';
  if (path === '/compare/nuke-vs-bat-results') return 'bat';
  return null;
}

const INDEX_FAQS: { q: string; a: string }[] = [
  {
    q: 'Is Nuke a Hagerty, CLASSIC.COM, or Bring a Trailer alternative?',
    a: 'Only in a narrow sense. Hagerty publishes a Price Guide and sells collector-car insurance. CLASSIC.COM is a search engine, market database, and sales platform where an owner can list a car for sale. Bring a Trailer is an online vehicle auction platform that publishes searchable auction results. Nuke is an observational ledger: not a price guide, not a marketplace, and not an insurer. Venues are sources. Comparisons on these pages use only claims taken from competitor pages fetched on 2026-11-23, plus Nuke behavior that already exists in the public repository.',
  },
];

function indexFace(): FacePage {
  const path = '/compare';
  const url = `${SITE}${path}`;
  const title = 'Compare Nuke | Nuke';
  const description =
    'Factual comparisons of Nuke with the Hagerty Price Guide, CLASSIC.COM, and Bring a Trailer auction results. Competitor claims are linked to pages fetched on 2026-11-23; unsourced claims are omitted.';
  const body =
    `<main><article>` +
    crumbs([{ label: 'Nuke', href: `${SITE}/` }, { label: 'About', href: `${SITE}/about` }]) +
    `<h1>Compare Nuke</h1>` +
    `<p>These pages compare what competitor sites said about themselves on ${COMPARE_FETCHED_ON} with what Nuke already does in its public repository. A claim that could not be sourced was left out. Nuke is not a price guide, not a marketplace, and not an insurer: nothing is listed or sold here.</p>` +
    `<ul>` +
    `<li><a href="${SITE}/compare/nuke-vs-hagerty">Nuke vs the Hagerty Price Guide</a></li>` +
    `<li><a href="${SITE}/compare/nuke-vs-classic-com">Nuke vs CLASSIC.COM</a></li>` +
    `<li><a href="${SITE}/compare/nuke-vs-bat-results">Nuke vs Bring a Trailer results</a></li>` +
    `</ul>` +
    `<p>The same index is also served at <a href="${SITE}/alternatives">/alternatives</a>. See also <a href="${SITE}/methodology">methodology</a>, <a href="${SITE}/about">about</a>, and <a href="${SITE}/sources">sources</a>.</p>` +
    INDEX_FAQS.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqLd(url, 'Compare Nuke', description, INDEX_FAQS)) };
}

function alternativesFace(): FacePage {
  const page = indexFace();
  const path = '/alternatives';
  const url = `${SITE}${path}`;
  const title = 'Alternatives to Nuke | Nuke';
  return {
    ...page,
    path,
    title,
    body: page.body.replace('<h1>Compare Nuke</h1>', '<h1>Alternatives to Nuke</h1>'),
    head: ldScript(faqLd(url, 'Alternatives to Nuke', page.description, INDEX_FAQS)),
  };
}

const HAGERTY_FAQS: { q: string; a: string }[] = [
  {
    q: 'Does Nuke replace a Hagerty valuation or insurance policy?',
    a: 'No. Hagerty publishes Price Guide values at Hagerty Valuation Tools and offers classic and collector car insurance. Nuke does not sell insurance and is not a price guide. Its /valuation tool reports recorded Bring a Trailer sold-result evidence for a year, make, and model cohort, without matching condition and equipment.',
  },
];

function hagertyFace(): FacePage {
  const path = '/compare/nuke-vs-hagerty';
  const url = `${SITE}${path}`;
  const title = 'Nuke vs Hagerty | Nuke';
  const description =
    'What the Hagerty Price Guide and Hagerty insurance pages said on 2026-11-23, next to what Nuke actually does. No accuracy or price comparison is made.';
  const body =
    `<main><article>` +
    crumbs([{ label: 'Nuke', href: `${SITE}/` }, { label: 'Compare', href: `${SITE}/compare` }]) +
    `<h1>Nuke vs the Hagerty Price Guide</h1>` +
    `<p>This page compares published product descriptions. It does not say which number is more accurate, and it does not compare prices or coverage counts.</p>` +
    `<section><h2>What Hagerty publishes</h2>` +
    `<p>A Hagerty Media article, ${ref('hagerty-method')}, describes the Hagerty Price Guide values published online at Hagerty Valuation Tools as “a guide to collector car values in the North American market,” and says the analysis “is still a high-touch, human-centered process.” The same article notes a common assumption that the guide “is an algorithm derived from insurance values” or “an average of auction sales,” and then lists the data it uses: auction results, peer-to-peer sales, asking prices, and dealer and broker sales. It also says peer-to-peer sale prices can come from insurance customers who choose to share them: “This is where being a large insurance provider comes in handy.”</p>` +
    `<p>${ref('hagerty-valuation-tool')} says the tool uses “four different condition classifications for every rated vehicle.”</p>` +
    `<p>${ref('hagerty-insurance')} presents “Classic and collector car insurance,” with insurance services administered by Hagerty Insurance Agency, LLC.</p></section>` +
    `<section><h2>What Nuke does</h2>` +
    `<p>Nuke’s <a href="${SITE}/about">About</a> page says it is not a price guide and not a marketplace: nothing is listed or sold here. It does not sell insurance. Language and vision models are sensors, never sources, as stated in <a href="https://github.com/sss97133/nuke/blob/main/docs/POSITIONING.md">docs/POSITIONING.md</a>.</p>` +
    `<p>The <a href="${SITE}/valuation">valuation</a> page calls <code>valuation_by_ymm</code> against recorded Bring a Trailer sold-result snapshots. Condition and equipment are not matched. Advisor instructions say asking prices are not sales, and confidence is capped at 0.6 until a published sale backtest justifies more. Predictions that have been graded are published in the daily table at <a href="${SITE}/evidence.md">/evidence.md</a> and on About when that file can be read. Methodology is at <a href="${SITE}/methodology">/methodology</a>.</p></section>` +
    `<section><h2>What this page does not claim</h2>` +
    `<p>It does not claim that Hagerty does or does not publish an error table; none was found on the pages cited here. It does not treat asking prices as sales on either side. It does not compare the number of vehicles in the Hagerty guide with the number of observations Nuke holds.</p></section>` +
    HAGERTY_FAQS.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqLd(url, 'Nuke vs Hagerty', description, HAGERTY_FAQS)) };
}

const CLASSIC_FAQS: { q: string; a: string }[] = [
  {
    q: 'Is Nuke a CLASSIC.COM alternative?',
    a: 'Not as a place to list or buy a car. CLASSIC.COM describes itself as a search engine and pricing database and a sales platform; an owner can list a car for sale. Nuke is not a marketplace. CLASSIC.COM also says its CMB and Average Price figures should not be used as the exact value of a specific vehicle; Nuke likewise reports cohort recorded-sale evidence and caps advisor confidence rather than offering an unsourced point value for a specific car.',
  },
];

function classicFace(): FacePage {
  const path = '/compare/nuke-vs-classic-com';
  const url = `${SITE}${path}`;
  const title = 'Nuke vs CLASSIC.COM | Nuke';
  const description =
    'What CLASSIC.COM’s about and support pages said on 2026-11-23, next to what Nuke actually does. No coverage or accuracy comparison is made.';
  const body =
    `<main><article>` +
    crumbs([{ label: 'Nuke', href: `${SITE}/` }, { label: 'Compare', href: `${SITE}/compare` }]) +
    `<h1>Nuke vs CLASSIC.COM</h1>` +
    `<p>This page compares published product descriptions. It does not say which database is larger or which figure is more accurate.</p>` +
    `<section><h2>What CLASSIC.COM publishes</h2>` +
    `<p>${ref('classic-about')} describes CLASSIC.COM as a “search engine and pricing database” and lists a Market Database and a Sales Platform. It says cars “change hands at auctions, through dealers, and in private sales,” and that an owner can “Find out what your car is worth or list it for sale.”</p>` +
    `<p>${ref('classic-cmb')} defines CMB as the “CLASSIC.COM Market Benchmark,” says Average Price is “the mean sale price for a group of sold listings,” notes that CMB is calculated “placing greater weight on more recent transactions,” and states: “Neither figure should be used as the exact value of a specific vehicle.”</p>` +
    `<p>${ref('classic-valuation')} says: “Values are updated every day based on sale prices from over 600 auctions and dealers around the world.” That wording is from the page as fetched on ${COMPARE_FETCHED_ON}.</p></section>` +
    `<section><h2>What Nuke does</h2>` +
    `<p>Nuke is not a marketplace: nothing is listed or sold here. Sources are ranked on <a href="${SITE}/sources">/sources</a> by the lots Nuke holds, using <code>market_sources_read</code>. Year-cohort pages and <a href="${SITE}/valuation">/valuation</a> show recorded sold prices (valuation_by_ymm is Bring a Trailer sold-result snapshots; condition and equipment are not matched). The Asset Advisor cites sources and caps confidence at 0.6 until a published sale backtest justifies more. Asking prices are not sales.</p></section>` +
    `<section><h2>What this page does not claim</h2>` +
    `<p>It does not repeat unsourced coverage superlatives, and it does not compare source counts with Nuke’s held-lot counts, because those are not the same unit.</p></section>` +
    CLASSIC_FAQS.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqLd(url, 'Nuke vs CLASSIC.COM', description, CLASSIC_FAQS)) };
}

const BAT_FAQS: { q: string; a: string }[] = [
  {
    q: 'Does Nuke replace Bring a Trailer auction results?',
    a: 'No. Bring a Trailer is an online vehicle auction platform, and its About page says all auction results are published in a comprehensive, searchable database visible to everyone. Nuke is not an auction house. It treats Bring a Trailer as a source: /valuation and evaluate_listing work from recorded or live BaT listings, and evaluate_listing currently accepts Bring a Trailer URLs only.',
  },
];

function batFace(): FacePage {
  const path = '/compare/nuke-vs-bat-results';
  const url = `${SITE}${path}`;
  const title = 'Nuke vs Bring a Trailer results | Nuke';
  const description =
    'What Bring a Trailer’s About and Auction Results pages said on 2026-11-23, next to how Nuke uses BaT as a source. Nuke is not an auction platform.';
  const body =
    `<main><article>` +
    crumbs([{ label: 'Nuke', href: `${SITE}/` }, { label: 'Compare', href: `${SITE}/compare` }]) +
    `<h1>Nuke vs Bring a Trailer results</h1>` +
    `<p>This page compares a venue with a ledger that reads that venue as a source. It does not say Nuke holds a complete copy of BaT’s results database.</p>` +
    `<section><h2>What Bring a Trailer publishes</h2>` +
    `<p>${ref('bat-about')} states: “Bring a Trailer is an online vehicle auction platform and enthusiast community.” It says “We curate every vehicle that we list,” and: “All auction results are published in a comprehensive, searchable database that’s visible to everyone for all time.”</p>` +
    `<p>${ref('bat-results')} was headed “View 275,777 Completed Auctions” when fetched on ${COMPARE_FETCHED_ON}. That is a count from BaT’s page on that day, not a count of rows Nuke holds.</p></section>` +
    `<section><h2>What Nuke does</h2>` +
    `<p>Nuke is not a marketplace and not an auction platform: nothing is listed or sold here. Bring a Trailer appears as a source on the <a href="${SITE}/sources">sources board</a> (<code>market_sources_read</code>). The <a href="${SITE}/valuation">valuation</a> page reports recorded Bring a Trailer sold-result snapshots via <code>valuation_by_ymm</code>; condition and equipment are not matched. The Asset Advisor tool evaluate_listing currently accepts Bring a Trailer URLs only, as documented on <a href="${SITE}/mcp-advisor">/mcp-advisor</a>.</p></section>` +
    `<section><h2>What this page does not claim</h2>` +
    `<p>It does not equate BaT’s completed-auction heading with Nuke’s held-lot count, and it does not restate buyer-fee percentages from pages that were not used as citations here.</p></section>` +
    BAT_FAQS.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqLd(url, 'Nuke vs Bring a Trailer results', description, BAT_FAQS)) };
}

export function buildCompareFace(pathname: string): FacePage | null {
  const kind = parseComparePath(pathname);
  if (kind === 'index') {
    const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
    return path === '/alternatives' ? alternativesFace() : indexFace();
  }
  if (kind === 'hagerty') return hagertyFace();
  if (kind === 'classic') return classicFace();
  if (kind === 'bat') return batFace();
  return null;
}
