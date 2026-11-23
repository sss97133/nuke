import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  acceptEncodingHeader,
  buildUrlset,
  encodeSitemap,
  parseChunkParam,
  publicVehicleUrls,
  restEnvFromProcess,
  SITEMAP_UNAVAILABLE,
} from '../../../src/lib/sitemaps';

// GET /sitemap-vehicles/:chunk.xml — up to 50,000 public vehicle URLs.

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const chunk = parseChunkParam(req.query.chunk);
  if (chunk == null) return res.status(404).json({ error: 'not_found' });

  const env = restEnvFromProcess();
  if (!env) return res.status(500).json({ error: 'Server misconfigured' });

  const got = await publicVehicleUrls(env, chunk);
  if (!got.ok) {
    res.setHeader('Cache-Control', SITEMAP_UNAVAILABLE);
    return res.status(503).json({ error: 'upstream unavailable', upstream_status: got.status });
  }
  if (got.value.length === 0) return res.status(404).json({ error: 'not_found' });

  const encoded = encodeSitemap(buildUrlset(got.value), acceptEncodingHeader(req.headers['accept-encoding']));
  res.status(200);
  for (const [k, v] of Object.entries(encoded.headers)) res.setHeader(k, v);
  return res.send(encoded.body);
}
