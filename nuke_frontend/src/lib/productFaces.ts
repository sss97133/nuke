// Prerendered product landings for /valuation and /developers.
// Copy is limited to what those routes and the public API/MCP surfaces
// already do in this repo. No sample prices or unverified SDK claims.

import { SITE, escapeHtml, type FacePage } from './discoveryFace';

function ldScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

function faqPage(url: string, name: string, description: string, faqs: { q: string; a: string }[]): unknown {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name,
        url,
        description,
        applicationCategory: 'BusinessApplication',
        isAccessibleForFree: true,
        publisher: { '@type': 'Organization', name: 'Nuke', url: SITE },
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

const BAT_POLICY = 'https://bringatrailer.com/policies/';

export const VALUATION_FAQS: { q: string; a: string }[] = [
  {
    q: 'How does Nuke show recorded sale prices for a year, make, and model?',
    a:
      'The /valuation page calls the valuation_by_ymm reader with a year, make, and optional model. It compares that cohort against recorded Bring a Trailer sold-result snapshots and shows a median, distribution, and comparable sales with source links when those sales exist. Published winning bids exclude buyer fees, taxes, and transport, as described in BaT policy. Amounts stay in the original currency, without inflation or exchange-rate adjustment. Condition and equipment are not matched.',
  },
  {
    q: 'Is this an appraisal of a specific vehicle?',
    a:
      'No. It is recorded sale evidence for a year, make, and model cohort. A specific public Bring a Trailer listing can be evaluated with the Asset Advisor evaluate_listing tool at https://nuke.ag/mcp/advisor, which currently accepts Bring a Trailer URLs only.',
  },
];

export function valuationFace(): FacePage {
  const path = '/valuation';
  const url = `${SITE}${path}`;
  const title = 'Recorded sale prices | Nuke';
  const description =
    'Look up recorded Bring a Trailer sale evidence for a year, make, and model on Nuke. Median, range, and source-linked comps come from the valuation_by_ymm reader when sales exist.';
  const faqs = VALUATION_FAQS;
  const body =
    `<main><article>` +
    `<nav><a href="${SITE}/">Nuke</a> · <a href="${SITE}/cohort">Cohorts</a></nav>` +
    `<h1>Recorded sale prices</h1>` +
    `<p>Enter a year, make, and optional model to read recorded Bring a Trailer sold-result evidence for that cohort. The page calls the <code>valuation_by_ymm</code> reader and, when sales exist, shows a median, a distribution, and comparable sales with source links.</p>` +
    `<section><h2>What the figures are</h2>` +
    `<ul>` +
    `<li>Published winning bids exclude buyer fees, taxes, and transport (<a href="${BAT_POLICY}">BaT policy</a>).</li>` +
    `<li>Amounts stay in the original currency. There is no inflation or exchange-rate adjustment.</li>` +
    `<li>Condition and equipment are not matched.</li>` +
    `</ul></section>` +
    faqs.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `<p><a href="${SITE}/valuation">Open the valuation tool</a> · <a href="${SITE}/cohort">Cohort year pages</a> · <a href="${SITE}/mcp/advisor">Asset Advisor MCP</a></p>` +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqPage(url, 'Recorded sale prices', description, faqs)) };
}

export const DEVELOPERS_PUBLIC_LINKS = [
  { href: `${SITE}/api/v1/vehicle/`, label: 'Public vehicle API', note: 'GET /api/v1/vehicle/{id} returns a public vehicle record by UUID.' },
  { href: `${SITE}/api/docs`, label: 'API docs', note: 'OpenAPI-based documentation for the public HTTP API.' },
  { href: `${SITE}/mcp/advisor`, label: 'Asset Advisor MCP', note: 'Streamable HTTP MCP at https://nuke.ag/mcp/advisor. No credential. Six read-only tools: find_asset, get_asset, get_comps, value_asset, evaluate_listing, and budget_options.' },
  { href: `${SITE}/.well-known/mcp.json`, label: 'MCP server card', note: 'Machine-readable card for the Asset Advisor.' },
  { href: `${SITE}/llms.txt`, label: 'llms.txt', note: 'A text index of readable pages and how to connect the advisor.' },
] as const;

export const DEVELOPERS_FAQS: { q: string; a: string }[] = [
  {
    q: 'What can I call on Nuke without an API key?',
    a:
      'GET https://nuke.ag/api/v1/vehicle/{id} returns a public vehicle record. API documentation is at https://nuke.ag/api/docs. The read-only Asset Advisor MCP is a Streamable HTTP server at https://nuke.ag/mcp/advisor, with no credential, exposing find_asset, get_asset, get_comps, value_asset, evaluate_listing, and budget_options. A server card is at https://nuke.ag/.well-known/mcp.json and a text index is at https://nuke.ag/llms.txt.',
  },
  {
    q: 'Where is the rest of the developer documentation?',
    a:
      'The in-app hub at https://nuke.ag/developers also covers authenticated REST and other integrations. This page lists only the public, no-key surfaces so a crawler can cite what is callable without signing in.',
  },
];

export function developersFace(): FacePage {
  const path = '/developers';
  const url = `${SITE}${path}`;
  const title = 'Developers | Nuke';
  const description =
    'Public developer surfaces on Nuke: the vehicle HTTP API, API docs, and the read-only Asset Advisor MCP at /mcp/advisor (six cited tools, no credential).';
  const links = DEVELOPERS_PUBLIC_LINKS
    .map((l) => `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a> — ${escapeHtml(l.note)}</li>`)
    .join('');
  const faqs = DEVELOPERS_FAQS;
  const body =
    `<main><article>` +
    `<nav><a href="${SITE}/">Nuke</a> · <a href="${SITE}/valuation">Recorded sale prices</a></nav>` +
    `<h1>Developers</h1>` +
    `<p>These are the public, no-key surfaces a client or crawler can call today. The JavaScript hub on this URL also documents authenticated REST and other integrations after it loads.</p>` +
    `<section><h2>Public surfaces</h2><ul>${links}</ul></section>` +
    faqs.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqPage(url, 'Nuke developers', description, faqs)) };
}

export function productFace(pathname: string): FacePage | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (path === '/valuation') return valuationFace();
  if (path === '/developers') return developersFace();
  return null;
}
