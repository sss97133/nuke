// HTML for /api/docs (served by nuke_frontend/api/docs/index.ts).
// The page stays a Redoc viewer of /v1/openapi.json and adds a crawler-readable
// summary of surfaces already documented as public, plus a pointer to the contract.

import { SITE } from './discoveryFace';

export const API_DOCS_PATH = '/api/docs';
export const OPENAPI_PATH = '/v1/openapi.json';
export const API_DOCS_TITLE = 'Nuke API — OpenAPI Reference';
export const API_DOCS_DESCRIPTION =
  'Nuke Vehicle Data API OpenAPI reference, plus the public no-key surfaces already documented on /developers and /mcp-advisor.';

export const API_DOCS_PUBLIC_LINKS: { href: string; label: string; note: string }[] = [
  { href: `${SITE}/api/v1/vehicle/{id}`, label: 'GET /api/v1/vehicle/{id}', note: 'Public JSON vehicle document. No API key. {id} is a vehicle UUID.' },
  { href: `${SITE}/v1/openapi.json`, label: 'GET /v1/openapi.json', note: 'The OpenAPI 3 contract for the HTTP API, including authenticated routes.' },
  { href: `${SITE}/mcp/advisor`, label: 'POST /mcp/advisor', note: 'Read-only Nuke Asset Advisor, Streamable HTTP, no API key.' },
  { href: `${SITE}/.well-known/mcp.json`, label: 'GET /.well-known/mcp.json', note: 'Machine discovery document for the advisor.' },
  { href: `${SITE}/llms.txt`, label: 'GET /llms.txt', note: 'Crawler-oriented site map of public pages and tools.' },
];

export const API_DOCS_FAQS: { q: string; a: string }[] = [
  {
    q: 'Where is the HTTP API contract?',
    a: 'The OpenAPI 3 document is published at https://nuke.ag/v1/openapi.json and rendered on this page with Redoc. That document is the contract. This page does not treat every path in it as public or free of a key.',
  },
  {
    q: 'What can be called without a key?',
    a: 'The surfaces already listed on /developers: GET /api/v1/vehicle/{id} for a public vehicle document, POST /mcp/advisor for the read-only Asset Advisor, GET /.well-known/mcp.json, and GET /llms.txt. Other routes in the OpenAPI document may require authentication; consult the contract.',
  },
];

function ldScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

export function apiDocsHeadAndIntro(): { canonical: string; title: string; description: string; head: string; intro: string } {
  const url = `${SITE}${API_DOCS_PATH}`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        name: API_DOCS_TITLE,
        url,
        description: API_DOCS_DESCRIPTION,
        isPartOf: { '@type': 'WebSite', name: 'Nuke', url: SITE },
      },
      {
        '@type': 'FAQPage',
        url,
        mainEntity: API_DOCS_FAQS.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };
  const intro =
    `<section id="nuke-api-docs-intro">` +
    `<h1>Nuke API reference</h1>` +
    `<p>${API_DOCS_DESCRIPTION} The rendered reference below is driven by <a href="${SITE}${OPENAPI_PATH}">${OPENAPI_PATH}</a>.</p>` +
    `<ul>${API_DOCS_PUBLIC_LINKS.map((l) => `<li><a href="${l.href}">${l.label}</a> — ${l.note}</li>`).join('')}</ul>` +
    API_DOCS_FAQS.map((f) => `<section><h2>${f.q}</h2><p>${f.a}</p></section>`).join('') +
    `<p><a href="${SITE}/developers">Developers</a> · <a href="${SITE}/mcp-advisor">Asset Advisor how-to</a> · <a href="${SITE}/methodology">Methodology</a></p>` +
    `</section>`;
  const head =
    `<meta charset="utf-8" />` +
    `<title>${API_DOCS_TITLE}</title>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<meta name="description" content="${API_DOCS_DESCRIPTION}" />` +
    `<link rel="canonical" href="${url}" />` +
    `<link rel="icon" type="image/png" href="/favicon.png" />` +
    ldScript(graph);
  return { canonical: url, title: API_DOCS_TITLE, description: API_DOCS_DESCRIPTION, head, intro };
}

export function apiDocsHtml(): string {
  const { head, intro } = apiDocsHeadAndIntro();
  return `<!doctype html>
<html lang="en">
<head>
  ${head}
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #nuke-api-docs-intro { max-width: 52rem; margin: 1.5rem auto; padding: 0 1rem; }
  </style>
</head>
<body>
  ${intro}
  <redoc spec-url="${OPENAPI_PATH}" hide-loading></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>
`;
}
