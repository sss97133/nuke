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
    `<p><a href="${SITE}/valuation">Open the valuation tool</a> · <a href="${SITE}/cohort">Cohort year pages</a> · <a href="${SITE}/mcp-advisor">Asset Advisor MCP</a></p>` +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqPage(url, 'Recorded sale prices', description, faqs)) };
}

export const DEVELOPERS_PUBLIC_LINKS = [
  { href: `${SITE}/api/v1/vehicle/`, label: 'Public vehicle API', note: 'GET /api/v1/vehicle/{id} returns a public vehicle record by UUID.' },
  { href: `${SITE}/api/docs`, label: 'API docs', note: 'OpenAPI-based documentation for the public HTTP API.' },
  { href: `${SITE}/mcp-advisor`, label: 'Asset Advisor MCP', note: 'How to connect the Streamable HTTP advisor at https://nuke.ag/mcp/advisor. No credential. Six read-only tools: find_asset, get_asset, get_comps, value_asset, evaluate_listing, and budget_options.' },
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


/** Official tool catalog from supabase/functions/mcp-connector/advisor/tools.ts (must stay in lockstep; tests read that file). */
export const ADVISOR_TOOLS = [
  { name: 'find_asset', title: 'Find Asset', description: 'Find a vehicle in Nuke by VIN, listing URL, or year/make/model text. Use when you need an asset_id before get_asset, get_comps, or value_asset.' },
  { name: 'get_asset', title: 'Get Asset', description: "Load one vehicle's identity, price facts, coverage, and sale/relist history with citations. Use after find_asset when you have an asset_id." },
  { name: 'get_comps', title: 'Get Comparables', description: 'Return comparable confirmed sales for a vehicle (variant-matched, deduped). Use to inspect peer hammers with source URLs and dates.' },
  { name: 'value_asset', title: 'Value Asset', description: 'Estimate value for a known asset_id from recent same-asset sales and variant-matched comps. Use when you already have the Nuke vehicle id.' },
  { name: 'evaluate_listing', title: 'Evaluate Listing', description: "Evaluate a public listing URL: verdict, value range, prior sales/relists of the same car, top comps, and red flags. Prefer this for any 'is this a good buy?' question. listing.price_kind says what the page price is (sold | high_bid_reserve_not_met | current_bid | ask) with price_basis (hammer = before buyer fee); all_in (price + cited buyer fee + transport + paperwork), position (percentile among the comps shown) and trend (12-month cohort median vs prior 12 months, with n) are cited. A Bring a Trailer lot not yet in Nuke is landed on the spot (ingest.status = ingested, ~10 s budget) and evaluated in full; on timeout it is queued (ingest.status = timeout). For a live BaT lot, stored_bid compares Nuke's stored bid with the page's; when Nuke is behind, a re-read is dispatched and a red flag says so (the answer always uses the page)." },
  { name: 'budget_options', title: 'Budget Options', description: 'Rank what kinds of collector cars a budget typically buys: segments whose all-in cost (hammer + buyer fee + transport + paperwork) fits, with sales counts, price ranges, 3-year trend and why. Options, not financial advice.' },
] as const;

export const ADVISOR_ENDPOINT = `${SITE}/mcp/advisor`;
export const ADVISOR_PROTOCOL = '2025-03-26';
export const ADVISOR_TRANSPORT = 'streamable-http';
export const ADVISOR_VERSION = '1.1.0';

/** Official client how-to pages fetched for this landing. */
export const ADVISOR_CLIENT_DOCS = {
  claude: 'https://claude.com/docs/connectors/custom/add-unlisted',
  cursor: 'https://cursor.com/docs/mcp',
  chatgpt: 'https://developers.openai.com/api/docs/guides/custom-mcp-server',
  chatgptConnect: 'https://developers.openai.com/plugins/deploy/connect-chatgpt',
} as const;

export const CURSOR_MCP_JSON = `{
  "mcpServers": {
    "nuke-asset-advisor": {
      "url": "https://nuke.ag/mcp/advisor"
    }
  }
}`;

export const ADVISOR_FAQS: { q: string; a: string }[] = [
  {
    q: 'What is the Nuke Asset Advisor?',
    a: `A read-only, citation-first Model Context Protocol server for collector vehicles. It speaks Streamable HTTP (protocol ${ADVISOR_PROTOCOL}) at ${ADVISOR_ENDPOINT}, version ${ADVISOR_VERSION}. No credential is required. It exposes six tools: find_asset, get_asset, get_comps, value_asset, evaluate_listing, and budget_options. evaluate_listing currently accepts Bring a Trailer listing URLs only. The server has no write, admin, shop, SQL, or photo-analysis tools. A machine-readable card is at ${SITE}/.well-known/mcp.json.`,
  },
  {
    q: 'How do I connect Claude, ChatGPT, or Cursor?',
    a: `Use the Streamable HTTP URL ${ADVISOR_ENDPOINT} and choose no sign-in / no authentication. In Claude, add a custom connector (see ${ADVISOR_CLIENT_DOCS.claude}). In Cursor, put that URL in mcp.json (see ${ADVISOR_CLIENT_DOCS.cursor}). In ChatGPT, add a custom MCP server as a plugin (see ${ADVISOR_CLIENT_DOCS.chatgpt}).`,
  },
];

export function mcpAdvisorFace(): FacePage {
  const path = '/mcp-advisor';
  const url = `${SITE}${path}`;
  const title = 'Nuke Asset Advisor MCP | Nuke';
  const description =
    'Connect the read-only Nuke Asset Advisor to Claude, ChatGPT, or Cursor. Streamable HTTP at https://nuke.ag/mcp/advisor, no credential, six cited tools.';
  const tools = ADVISOR_TOOLS.map((t) =>
    `<dt><code>${escapeHtml(t.name)}</code> — ${escapeHtml(t.title)}</dt><dd>${escapeHtml(t.description)}</dd>`
  ).join('');
  const faqs = ADVISOR_FAQS;
  const body =
    `<main><article>` +
    `<nav><a href="${SITE}/">Nuke</a> · <a href="${SITE}/developers">Developers</a> · <a href="${SITE}/valuation">Recorded sale prices</a></nav>` +
    `<h1>Nuke Asset Advisor</h1>` +
    `<p>The Asset Advisor is a read-only Model Context Protocol server. Clients connect over Streamable HTTP to <code>${escapeHtml(ADVISOR_ENDPOINT)}</code> (protocol ${escapeHtml(ADVISOR_PROTOCOL)}, server version ${escapeHtml(ADVISOR_VERSION)}). No credential is required. Answers come from public records only. A machine-readable server card is at <a href="${SITE}/.well-known/mcp.json">/.well-known/mcp.json</a>.</p>` +
    `<section><h2>Tools</h2><p>These six tools are the advisor catalog in <code>supabase/functions/mcp-connector/advisor/tools.ts</code>.</p><dl>${tools}</dl>` +
    `<p>evaluate_listing currently accepts Bring a Trailer URLs only. The advisor surface has no write, admin, shop, SQL, or photo-analysis tools. Advisor instructions in that same file cap confidence at 0.6 until a published sale backtest justifies more, and say never to invent missing values.</p></section>` +
    `<section><h2>Connect in Claude</h2><p>Claude adds a remote MCP server as a custom connector, not as a <code>claude_desktop_config.json</code> stdio entry. Official steps: <a href="${ADVISOR_CLIENT_DOCS.claude}">Add a connector that isn't in the directory</a>.</p><ol>` +
    `<li>Open the Connectors directory and choose Add, then Add custom connector.</li>` +
    `<li>Name it (for example, Nuke Asset Advisor) and set the server URL to <code>${escapeHtml(ADVISOR_ENDPOINT)}</code>.</li>` +
    `<li>For authentication, choose no sign-in. The advisor does not require a credential.</li>` +
    `<li>Leave transport at the default Streamable HTTP (do not treat this URL as SSE).</li>` +
    `</ol></section>` +
    `<section><h2>Connect in Cursor</h2><p>Cursor documents Streamable HTTP MCP servers as a <code>url</code> entry in <code>mcp.json</code>. Official steps: <a href="${ADVISOR_CLIENT_DOCS.cursor}">Cursor MCP documentation</a>. Put the file at <code>~/.cursor/mcp.json</code> (all projects) or <code>.cursor/mcp.json</code> in a project. No headers are required.</p>` +
    `<pre><code>${escapeHtml(CURSOR_MCP_JSON)}</code></pre></section>` +
    `<section><h2>Connect in ChatGPT</h2><p>ChatGPT connects to a public Streamable HTTP MCP server as a custom plugin. Official steps: <a href="${ADVISOR_CLIENT_DOCS.chatgpt}">Add custom MCP server</a> and <a href="${ADVISOR_CLIENT_DOCS.chatgptConnect}">Connect and test your plugin</a>.</p><ol>` +
    `<li>On ChatGPT on the web, open Plugins, select the plus button, then Add custom MCP server.</li>` +
    `<li>Enter a name and, under Connection, the server URL <code>${escapeHtml(ADVISOR_ENDPOINT)}</code>.</li>` +
    `<li>Choose no authentication. Review the risk warning and create the plugin, then install it before using it in a conversation.</li>` +
    `</ol></section>` +
    faqs.map((f) => `<section><h2>${escapeHtml(f.q)}</h2><p>${escapeHtml(f.a)}</p></section>`).join('') +
    `<p>The protocol endpoint is <a href="${ADVISOR_ENDPOINT}">${escapeHtml(ADVISOR_ENDPOINT)}</a>. This page is the human how-to; MCP clients should call that URL, not /mcp-advisor.</p>` +
    `</article></main>`;
  return { title, description, path, type: 'website', body, head: ldScript(faqPage(url, 'Nuke Asset Advisor MCP', description, faqs)) };
}

export function productFace(pathname: string): FacePage | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (path === '/valuation') return valuationFace();
  if (path === '/developers') return developersFace();
  if (path === '/mcp-advisor') return mcpAdvisorFace();
  return null;
}
