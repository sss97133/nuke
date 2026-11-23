import type { VercelRequest, VercelResponse } from '@vercel/node';
import { acceptEncodingHeader, buildStaticSitemap, encodeSitemap } from '../../src/lib/sitemaps';

// GET /sitemap-static.xml — prerendered marketing and legal URLs.

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const encoded = encodeSitemap(buildStaticSitemap(), acceptEncodingHeader(req.headers['accept-encoding']));
  res.status(200);
  for (const [k, v] of Object.entries(encoded.headers)) res.setHeader(k, v);
  return res.send(encoded.body);
}
