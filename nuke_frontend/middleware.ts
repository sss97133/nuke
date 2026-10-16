/**
 * Vercel Edge Middleware
 *
 * Runs on every matched request BEFORE static file serving.
 *
 * /vehicle/:id        — dynamic vehicle data injection for AI readability,
 *                        OG tags, JSON-LD, and Accept: application/json support
 * /, /market, /journal, /llms.txt — readable text for crawlers and AI readers (the app is drawn by JavaScript, so
 *                        without this they see a title and nothing else). Numbers come from market_sources_read()
 *                        through the anon key, each with its own date; if the read fails the page says so and shows no number.
 */

export const config = {
  matcher: ['/', '/market', '/journal', '/llms.txt', '/vehicle/:path*', '/api/v1/vehicle/:path*'],
};

// ── Vehicle data config ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const VEHICLE_SELECT = [
  'id', 'vin', 'year', 'make', 'model', 'trim', 'series', 'body_style',
  'engine_type', 'transmission', 'drivetrain', 'color', 'interior_color',
  'mileage', 'sale_price', 'description', 'primary_image_url', 'image_count',
  'city', 'state', 'status', 'data_quality_score', 'listing_url',
  'nuke_estimate', 'created_at', 'updated_at',
].join(',');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function vehicleTitle(v: Record<string, unknown>): string {
  const parts = [v.year, v.make, v.model].filter(Boolean);
  if (v.trim) parts.push(v.trim as string);
  return parts.join(' ');
}

function vehicleDescription(v: Record<string, unknown>): string {
  const parts: string[] = [];
  const title = vehicleTitle(v);
  parts.push(title);
  if (v.color) parts.push(`${v.color}`);
  if (v.engine_type) parts.push(`${v.engine_type}`);
  if (v.transmission) parts.push(`${v.transmission}`);
  if (v.mileage) parts.push(`${Number(v.mileage).toLocaleString()} miles`);
  if (v.sale_price) parts.push(`Sold for $${Number(v.sale_price).toLocaleString()}`);
  if (v.city && v.state) parts.push(`${v.city}, ${v.state}`);
  return parts.join(' · ');
}

function buildJsonLd(v: Record<string, unknown>): string {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Vehicle',
    name: vehicleTitle(v),
    url: `https://nuke.ag/vehicle/${v.id}`,
    vehicleIdentificationNumber: v.vin || undefined,
    modelDate: v.year ? String(v.year) : undefined,
    manufacturer: v.make || undefined,
    model: v.model || undefined,
    bodyType: v.body_style || undefined,
    driveWheelConfiguration: v.drivetrain || undefined,
    vehicleTransmission: v.transmission || undefined,
    color: v.color || undefined,
    vehicleInteriorColor: v.interior_color || undefined,
    mileageFromOdometer: v.mileage
      ? { '@type': 'QuantitativeValue', value: v.mileage, unitCode: 'SMI' }
      : undefined,
    description: v.description || undefined,
  };
  if (v.primary_image_url) ld.image = v.primary_image_url;
  if (v.sale_price) {
    ld.offers = {
      '@type': 'Offer',
      price: v.sale_price,
      priceCurrency: 'USD',
      availability: 'https://schema.org/SoldOut',
    };
  }
  // Strip undefined values
  return JSON.stringify(ld, (_, val) => (val === undefined ? undefined : val));
}

// ── Fetch vehicle from PostgREST ─────────────────────────────────────────────

async function fetchVehicle(vehicleId: string): Promise<Record<string, unknown> | null> {
  const apiUrl = `${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}&is_public=eq.true&select=${VEHICLE_SELECT}`;
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: 'application/json',
      },
    });
    if (resp.ok) {
      const rows = await resp.json();
      if (rows && rows.length > 0) return rows[0];
    }
  } catch {
    // Return null on fetch error
  }
  return null;
}


// ── Public face: readable text for crawlers and AI readers ──────────────────

const INTERNAL_HEADER = 'x-nuke-internal';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
// Held-lot counts refresh daily at 10:27Z and the board snapshot at 10:47Z; a few hours of edge cache is enough.
const FACE_CACHE = 'public, s-maxage=10800, stale-while-revalidate=86400';

type SourceLine = {
  name: string; category: string | null; held: number | null; heldAt: string | null;
  population: number | null; method: string | null; confidence: number | null; populationAt: string | null;
};
type Board = { asOf: string; lines: SourceLine[] } | null;

function numOrNull(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
}
function strOrNull(x: unknown): string | null { return typeof x === 'string' && x ? x : null; }

/** The Sources board, decoded by column name (same contract as SourcesBoard.tsx). Null when the read fails. */
async function fetchBoard(): Promise<Board> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/market_sources_read`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const v = await resp.json() as { as_of?: unknown; columns?: unknown; rows?: unknown };
    if (typeof v.as_of !== 'string' || !Array.isArray(v.columns) || !Array.isArray(v.rows)) return null;
    const at = (c: string) => (v.columns as unknown[]).indexOf(c);
    const lines: SourceLine[] = [];
    for (const r of v.rows as unknown[][]) {
      if (!Array.isArray(r)) continue;
      const g = (c: string) => (at(c) >= 0 ? r[at(c)] : null);
      const name = strOrNull(g('name'));
      if (!name) continue;
      lines.push({
        name, category: strOrNull(g('category')), held: numOrNull(g('held_lots')), heldAt: strOrNull(g('held_at')),
        population: numOrNull(g('population')), method: strOrNull(g('population_method')),
        confidence: numOrNull(g('population_confidence')), populationAt: strOrNull(g('population_at')),
      });
    }
    lines.sort((a, b) => (b.held ?? 0) - (a.held ?? 0));
    return { asOf: v.as_of, lines };
  } catch {
    return null;
  }
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'unknown');
const fmt = (n: number | null) => (n == null ? 'unknown' : n.toLocaleString('en-US'));

/** One line per source: the lots held with the day counted, and the source's own total with method, confidence, day. */
function sourceSentence(l: SourceLine): string {
  const held = `${fmt(l.held)} lots held (counted ${day(l.heldAt)})`;
  const pop = l.population == null
    ? 'source total unknown'
    : `source total ${fmt(l.population)} (${l.method ?? 'method not recorded'}, confidence ${l.confidence ?? 'not recorded'}, ${day(l.populationAt)})`;
  return `${l.name}: ${held}; ${pop}.`;
}

const ABOUT = 'Nuke (nuke.ag) is a data machine: an append-only, bitemporal record of observations about physical assets, ' +
  'with provenance on every row and computed stacks over it. Vehicles are the first entity. Every bid, comment, photo, ' +
  'receipt or title transfer lands once in a log, is keyed to every entity it mentions, and is folded into state, ' +
  'baselines, residuals and predictions that are later graded against what happened.';

type FacePage = { path: string; title: string; heading: string; lead: string; withBoard: boolean };
const FACE: Record<string, FacePage> = {
  '/': {
    path: '/', title: 'Nuke — a data machine for physical assets', heading: 'Nuke',
    lead: ABOUT, withBoard: true,
  },
  '/market': {
    path: '/market', title: 'Nuke Market — every auction house, same measures',
    heading: 'Market: every source on the same measures',
    lead: 'Each market is ranked by the lots Nuke holds for it. Every count carries the day it was measured and, where known, ' +
      'the size of the source it is measured against, with the method and confidence of that size.',
    withBoard: true,
  },
  '/journal': {
    path: '/journal', title: 'Nuke Journal — a shop work-log from the record', heading: 'Journal',
    lead: 'Each date projects a shop work-log from the record: photos, receipts and work on the vehicles in the build. ' +
      'The entries are drawn in the app and are not listed here.',
    withBoard: false,
  },
};

function boardHtml(b: Board): string {
  if (!b) return '<p>The live source counts could not be read at this moment, so none are shown here. Open the page in a browser for the board.</p>';
  const top = b.lines.slice(0, 15);
  return `<h2>Sources, ranked by lots held (read ${escapeHtml(b.asOf)})</h2><ol>${
    top.map((l) => `<li>${escapeHtml(sourceSentence(l))}</li>`).join('')}</ol>` +
    `<p>${b.lines.length} sources are on the board; the first ${top.length} are listed. A count is lots Nuke holds, not the number that exist; ` +
    'where the source total is unknown the line says so.</p>';
}

function faceBody(page: FacePage, b: Board): string {
  return `<main><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.lead)}</p>${page.withBoard ? boardHtml(b) : ''}` +
    '<h2>Read it</h2><ul>' +
    '<li><a href="https://github.com/sss97133/nuke">The repository and its generated, dated numbers</a></li>' +
    '<li><a href="https://nuke.ag/llms.txt">llms.txt</a></li>' +
    '<li><a href="https://nuke.ag/mcp">MCP endpoint</a> · <a href="https://nuke.ag/developers">API and developers</a></li>' +
    '<li><a href="https://nuke.ag/market">Market</a> · <a href="https://nuke.ag/journal">Journal</a></li></ul></main>';
}

function injectFace(html: string, page: FacePage, b: Board): string {
  const t = escapeHtml(page.title);
  const d = escapeHtml(page.lead.slice(0, 300));
  const url = `https://nuke.ag${page.path === '/' ? '' : page.path}`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${d}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${t}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${d}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${url}" />`);
  html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${url}" />`);
  // React's createRoot replaces everything inside #root on mount, so people see the app and readers without JS see this.
  return html.replace('<div id="root"></div>', `<div id="root">${faceBody(page, b)}</div>`);
}

function llmsTxt(b: Board): string {
  const lines = [
    '# Nuke', '', `> ${ABOUT}`, '',
    '## Read these first',
    '- [Repository README, with generated and dated numbers](https://github.com/sss97133/nuke)',
    '- [The data machine: nine layers from log to outcome](https://github.com/sss97133/nuke/blob/main/docs/ledger/theory/data-machine.md)',
    '- [Evidence: graded predictions and the stack registry](https://nuke.ag/evidence.md)',
    '', '## Use it',
    '- [MCP endpoint](https://nuke.ag/mcp)',
    '- [Vehicle API: GET /api/v1/vehicle/{id}](https://nuke.ag/api/v1/vehicle)',
    '- [Developers](https://nuke.ag/developers)',
    '- [Sitemap](https://nuke.ag/sitemap.xml)',
    '', '## Sources and their coverage',
  ];
  if (b) {
    lines.push(`Read ${b.asOf}. A count is lots Nuke holds; the source total is what exists, with its method.`, '');
    for (const l of b.lines.slice(0, 15)) lines.push(`- ${sourceSentence(l)}`);
  } else {
    lines.push('The live counts could not be read when this file was produced, so none are listed.');
  }
  lines.push('', '## Notes',
    '- Every number on the site carries a date. A bare number without one is a bug; report it.',
    '- Pages are drawn by JavaScript; this file and the HTML text on each page are the readable summary.');
  return lines.join('\n') + '\n';
}

// ── Fetch base HTML ──────────────────────────────────────────────────────────

async function getBaseHtml(requestUrl: string): Promise<string> {
  const rootUrl = new URL('/', requestUrl).toString();
  const base = await fetch(rootUrl, { headers: { [INTERNAL_HEADER]: '1' } });
  return base.text();
}

// ── Inject vehicle data into HTML ────────────────────────────────────────────

function injectVehicleData(html: string, v: Record<string, unknown>): string {
  const title = escapeHtml(vehicleTitle(v));
  const desc = escapeHtml(vehicleDescription(v));
  const pageTitle = `${vehicleTitle(v)} | Nuke`;
  const url = `https://nuke.ag/vehicle/${v.id}`;
  const image = (v.primary_image_url as string) || 'https://nuke.ag/og-image.png';

  // Replace title
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`);

  // Replace meta description
  html = html.replace(
    /<meta name="description" content="[^"]*"\s*\/>/,
    `<meta name="description" content="${desc}" />`,
  );

  // Replace OG tags
  html = html.replace(
    /<meta property="og:title" content="[^"]*"\s*\/>/,
    `<meta property="og:title" content="${title}" />`,
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*"\s*\/>/,
    `<meta property="og:description" content="${desc}" />`,
  );
  html = html.replace(
    /<meta property="og:url" content="[^"]*"\s*\/>/,
    `<meta property="og:url" content="${url}" />`,
  );
  html = html.replace(
    /<meta property="og:image" content="[^"]*"\s*\/>/,
    `<meta property="og:image" content="${image}" />`,
  );
  html = html.replace(
    /<meta property="og:type" content="[^"]*"\s*\/>/,
    `<meta property="og:type" content="product" />`,
  );

  // Replace Twitter tags
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*"\s*\/>/,
    `<meta name="twitter:title" content="${title}" />`,
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*"\s*\/>/,
    `<meta name="twitter:description" content="${desc}" />`,
  );
  html = html.replace(
    /<meta name="twitter:image" content="[^"]*"\s*\/>/,
    `<meta name="twitter:image" content="${image}" />`,
  );

  // Replace existing JSON-LD with vehicle-specific one
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n${buildJsonLd(v)}\n</script>`,
  );

  // Visible text for readers that do not run JavaScript; React's createRoot replaces it on mount.
  const facts: [string, unknown][] = [
    ['VIN', v.vin], ['Color', v.color], ['Engine', v.engine_type], ['Transmission', v.transmission],
    ['Drivetrain', v.drivetrain], ['Body', v.body_style],
    ['Mileage', v.mileage ? `${Number(v.mileage).toLocaleString('en-US')} miles` : null],
    ['Sold for', v.sale_price ? `$${Number(v.sale_price).toLocaleString('en-US')}` : null],
    ['Location', v.city && v.state ? `${v.city}, ${v.state}` : null],
  ];
  const rows = facts.filter(([, x]) => x).map(([k, x]) => `<dt>${k}</dt><dd>${escapeHtml(String(x))}</dd>`).join('');
  const blurb = typeof v.description === 'string' ? `<p>${escapeHtml(v.description.slice(0, 1200))}</p>` : '';
  html = html.replace('<div id="root"></div>',
    `<div id="root"><article><h1>${escapeHtml(vehicleTitle(v))}</h1><dl>${rows}</dl>${blurb}` +
    `<p>Record last updated ${escapeHtml(day(typeof v.updated_at === 'string' ? v.updated_at : null))}. <a href="https://nuke.ag/api/v1/vehicle/${escapeHtml(String(v.id))}">JSON</a></p></article></div>`);

  // Inject vehicle data JSON and API meta tag before </head>
  const vehicleDataScript = `<script type="application/json" id="vehicle-data">${JSON.stringify(v)}</script>`;
  const apiMeta = `<meta name="nuke:api" content="https://nuke.ag/api/v1/vehicle/${v.id}" />`;
  html = html.replace('</head>', `${apiMeta}\n${vehicleDataScript}\n</head>`);

  return html;
}

// ── Main middleware ──────────────────────────────────────────────────────────

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);

  // The base-HTML fetch below calls this deployment's own root; let it through to the static shell.
  if (request.headers.get(INTERNAL_HEADER)) return undefined;

  // ── /llms.txt and the readable public pages ──
  if (url.pathname === '/llms.txt') {
    return new Response(llmsTxt(await fetchBoard()), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': FACE_CACHE, 'Access-Control-Allow-Origin': '*' },
    });
  }
  const face = FACE[url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname];
  if (face) {
    const [html, board] = await Promise.all([getBaseHtml(request.url), face.withBoard ? fetchBoard() : Promise.resolve(null)]);
    return new Response(injectFace(html, face, board), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': FACE_CACHE },
    });
  }

  // ── /api/v1/vehicle/:id (REST API) ──
  const apiMatch = url.pathname.match(/^\/api\/v1\/vehicle\/([^/]+)/);
  if (apiMatch) {
    const apiVehicleId = apiMatch[1];
    if (!UUID_RE.test(apiVehicleId)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid vehicle ID',
          message: 'Vehicle ID must be a valid UUID. Example: /api/v1/vehicle/14123fbf-7eb6-4dd6-b0ca-bbc83db06a28',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
      );
    }
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    const vehicle = await fetchVehicle(apiVehicleId);
    if (!vehicle) {
      return new Response(
        JSON.stringify({ error: 'Vehicle not found', message: 'Vehicle does not exist or is not public.' }),
        { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
      );
    }
    return new Response(
      JSON.stringify({
        data: vehicle,
        meta: {
          url: `https://nuke.ag/vehicle/${vehicle.id}`,
          api_url: `https://nuke.ag/api/v1/vehicle/${vehicle.id}`,
          mcp_endpoint: 'https://nuke.ag/mcp',
          mcp_tool: 'get_vehicle',
          mcp_hint: 'For deeper data (events, images, comments, observations), connect via MCP at the endpoint above.',
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      },
    );
  }

  // ── /api/v1/vehicle/ (API docs, no ID) ──
  if (url.pathname === '/api/v1/vehicle' || url.pathname === '/api/v1/vehicle/') {
    return new Response(
      JSON.stringify({
        name: 'Nuke Vehicle API',
        version: '1.0',
        usage: {
          get_vehicle: {
            method: 'GET',
            path: '/api/v1/vehicle/{id}',
            description: 'Returns public vehicle data by UUID.',
            example: 'https://nuke.ag/api/v1/vehicle/14123fbf-7eb6-4dd6-b0ca-bbc83db06a28',
          },
        },
        mcp: {
          endpoint: 'https://nuke.ag/mcp',
          description: 'Model Context Protocol endpoint for deeper vehicle data. Supports 22 tools including get_vehicle, query_vehicle_deep, and search.',
        },
        docs: 'https://nuke.ag/developers',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=3600',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  // ── /vehicle/:id (dynamic vehicle data) ──
  const vehicleMatch = url.pathname.match(/^\/vehicle\/([^/]+)/);
  if (!vehicleMatch) return undefined;

  const vehicleId = vehicleMatch[1];
  if (!UUID_RE.test(vehicleId)) return undefined; // fall through to SPA

  // Check if we can fetch from Supabase
  if (!SUPABASE_URL || !SUPABASE_KEY) return undefined;

  const vehicle = await fetchVehicle(vehicleId);
  if (!vehicle) return undefined;

  // ── Accept: application/json → return raw JSON ──
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) {
    return new Response(
      JSON.stringify({
        data: vehicle,
        meta: {
          url: `https://nuke.ag/vehicle/${vehicle.id}`,
          api_url: `https://nuke.ag/api/v1/vehicle/${vehicle.id}`,
          mcp_endpoint: 'https://nuke.ag/mcp',
          mcp_tool: 'get_vehicle',
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  // ── HTML response with injected vehicle data ──
  let html = await getBaseHtml(request.url);
  html = injectVehicleData(html, vehicle);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
