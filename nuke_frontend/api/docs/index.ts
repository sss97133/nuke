// Vercel serverless function — public OpenAPI documentation page.
// Routes:
//   /api/docs           → this handler (Redoc HTML plus a crawler-readable intro)
//   /v1/openapi.json    → static asset at nuke_frontend/public/v1/openapi.json (no rewrite needed)
//
// DEPLOYED UNIVERSE: this file MUST live in nuke_frontend/api/. Both
// deploy-vercel.yml and deploy-preview.yml run `vercel deploy` with
// working-directory ./nuke_frontend, so only nuke_frontend/api/** becomes
// functions and nuke_frontend/vercel.json is the live routing config.
// Repo-root api/ is never uploaded (this handler lived there and prod
// /api/docs fell through to the mailbox 404 — same bug class as #273).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { apiDocsHtml } from '../../src/lib/apiDocsPage';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=300, s-maxage=300');
  res.setHeader('x-content-type-options', 'nosniff');
  return res.status(200).send(apiDocsHtml());
}
