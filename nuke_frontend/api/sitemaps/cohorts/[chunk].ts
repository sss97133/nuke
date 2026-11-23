import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  acceptEncodingHeader,
  allYearProfiles,
  buildUrlset,
  directorySitemapUrls,
  encodeSitemap,
  parseChunkParam,
  restEnvFromProcess,
  SITEMAP_UNAVAILABLE,
  yearCohortUrls,
} from '../../../src/lib/sitemaps';

// GET /sitemap-cohorts/:chunk.xml — year-make-model cohort URLs, 50,000 per chunk.

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const chunk = parseChunkParam(req.query.chunk);
  if (chunk == null) return res.status(404).json({ error: 'not_found' });

  const env = restEnvFromProcess();
  if (!env) return res.status(500).json({ error: 'Server misconfigured' });

  const got = await yearCohortUrls(env, chunk);
  if (!got.ok) {
    res.setHeader('Cache-Control', SITEMAP_UNAVAILABLE);
    return res.status(503).json({ error: 'upstream unavailable', upstream_status: got.status });
  }
  let urls = got.value;
  if (chunk === 0) {
    const profiles = await allYearProfiles(env);
    if (!profiles.ok) {
      res.setHeader('Cache-Control', SITEMAP_UNAVAILABLE);
      return res.status(503).json({ error: 'upstream unavailable', upstream_status: profiles.status });
    }
    urls = [...directorySitemapUrls(profiles.value), ...urls];
  }
  if (urls.length === 0) return res.status(404).json({ error: 'not_found' });

  const encoded = encodeSitemap(buildUrlset(urls), acceptEncodingHeader(req.headers['accept-encoding']));
  res.status(200);
  for (const [k, v] of Object.entries(encoded.headers)) res.setHeader(k, v);
  return res.send(encoded.body);
}
