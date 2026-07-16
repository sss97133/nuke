import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VEHICLE_SELECT = [
  'id', 'vin', 'year', 'make', 'model', 'trim', 'series', 'body_style',
  'engine_type', 'transmission', 'drivetrain', 'color', 'interior_color',
  'mileage', 'sale_price', 'description', 'primary_image_url', 'image_count',
  'city', 'state', 'status', 'data_quality_score', 'listing_url',
  'nuke_estimate', 'created_at', 'updated_at',
].join(',');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  const vehicleId = Array.isArray(id) ? id[0] : id;

  if (!vehicleId || !UUID_RE.test(vehicleId)) {
    return res.status(400).json({
      error: 'Invalid vehicle ID',
      message: 'Vehicle ID must be a valid UUID. Example: /api/v1/vehicle/14123fbf-7eb6-4dd6-b0ca-bbc83db06a28',
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const url = `${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}&is_public=eq.true&select=${VEHICLE_SELECT}`;

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return res.status(502).json({ error: 'Upstream error' });
  }

  const rows = await response.json();

  if (!rows || rows.length === 0) {
    return res.status(404).json({
      error: 'Vehicle not found',
      message: 'Vehicle does not exist or is not public.',
    });
  }

  const vehicle = rows[0];

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({
    data: vehicle,
    meta: {
      url: `https://nuke.ag/vehicle/${vehicle.id}`,
      api_url: `https://nuke.ag/api/v1/vehicle/${vehicle.id}`,
      mcp_endpoint: 'https://nuke.ag/mcp',
      mcp_tool: 'get_vehicle',
      mcp_hint: 'For deeper data (events, images, comments, observations), connect via MCP at the endpoint above.',
    },
  });
}
