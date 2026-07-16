/**
 * Vercel Edge Middleware
 *
 * Runs on every matched request BEFORE static file serving.
 *
 * /market/competitors — static OG tag injection for link previews
 * /vehicle/:id        — dynamic vehicle data injection for AI readability,
 *                        OG tags, JSON-LD, and Accept: application/json support
 */

export const config = {
  matcher: ['/market/competitors', '/vehicle/:path*', '/api/v1/vehicle/:path*'],
};

// ── Static OG for /market/competitors ────────────────────────────────────────

const COMPETITORS_OG = {
  title: 'Nuke vs. Rally vs. TheCarCrowd — Fractional Car Ownership Compared',
  description:
    'Rally raised $112M, has 9 cars, was fined $350K by the SEC. TheCarCrowd says on their own site they\'re "not FCA-regulated." The whole market is under $100M AUM. Nuke tracks 1.25M vehicles with real auction data.',
  url: 'https://nuke.ag/market/competitors',
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

// ── Fetch base HTML ──────────────────────────────────────────────────────────

async function getBaseHtml(requestUrl: string): Promise<string> {
  const rootUrl = new URL('/', requestUrl).toString();
  const base = await fetch(rootUrl);
  return base.text();
}

// ── Inject OG tags (static, for competitors) ────────────────────────────────

function injectStaticOg(html: string, og: typeof COMPETITORS_OG): string {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${og.title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*"\s*\/>/,
      `<meta name="description" content="${og.description}" />`,
    )
    .replace(
      /<meta property="og:title" content="[^"]*"\s*\/>/,
      `<meta property="og:title" content="${og.title}" />`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*"\s*\/>/,
      `<meta property="og:description" content="${og.description}" />`,
    )
    .replace(
      /<meta property="og:url" content="[^"]*"\s*\/>/,
      `<meta property="og:url" content="${og.url}" />`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*"\s*\/>/,
      `<meta name="twitter:title" content="${og.title}" />`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*"\s*\/>/,
      `<meta name="twitter:description" content="${og.description}" />`,
    );
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

  // Inject vehicle data JSON and API meta tag before </head>
  const vehicleDataScript = `<script type="application/json" id="vehicle-data">${JSON.stringify(v)}</script>`;
  const apiMeta = `<meta name="nuke:api" content="https://nuke.ag/api/v1/vehicle/${v.id}" />`;
  html = html.replace('</head>', `${apiMeta}\n${vehicleDataScript}\n</head>`);

  return html;
}

// ── Main middleware ──────────────────────────────────────────────────────────

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);

  // ── /market/competitors (static OG) ──
  if (url.pathname === '/market/competitors') {
    const html = await getBaseHtml(request.url);
    return new Response(injectStaticOg(html, COMPETITORS_OG), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
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
