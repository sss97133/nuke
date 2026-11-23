import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  acceptEncodingHeader,
  buildSitemapIndex,
  countPublicVehicles,
  countYearCohorts,
  encodeSitemap,
  restEnvFromProcess,
  SITEMAP_UNAVAILABLE,
} from '../../src/lib/sitemaps';

// GET /sitemap.xml — sitemap index of static, work, vehicle, and cohort urlsets.
// Deployed from nuke_frontend/api/; identity rewrites in vercel.json keep these
// off the mailbox /api/:path+ catch-all.

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const env = restEnvFromProcess();
  if (!env) return res.status(500).json({ error: 'Server misconfigured' });

  const [vehicles, cohorts] = await Promise.all([countPublicVehicles(env), countYearCohorts(env)]);
  if (!vehicles.ok || !cohorts.ok) {
    res.setHeader('Cache-Control', SITEMAP_UNAVAILABLE);
    return res.status(503).json({
      error: 'upstream unavailable',
      vehicles: vehicles.ok ? 'ok' : 'unread',
      cohorts: cohorts.ok ? 'ok' : 'unread',
      upstream_status: (!vehicles.ok ? vehicles.status : null) ?? (!cohorts.ok ? cohorts.status : null),
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const encoded = encodeSitemap(buildSitemapIndex(vehicles.value, cohorts.value, today), acceptEncodingHeader(req.headers['accept-encoding']));
  res.status(200);
  for (const [k, v] of Object.entries(encoded.headers)) res.setHeader(k, v);
  return res.send(encoded.body);
}
