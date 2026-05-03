// Vercel serverless function — public OpenAPI documentation page.
// Routes:
//   /api/docs           → this handler (Redoc HTML)
//   /v1/openapi.json    → static asset at nuke_frontend/public/v1/openapi.json (no rewrite needed)

import type { VercelRequest, VercelResponse } from '@vercel/node';

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Nuke API — OpenAPI Reference</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Nuke Vehicle Data API — OpenAPI 3.0 reference. Includes the External Agent Write API for LLM agents (Claude, ChatGPT, MCP clients)." />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body>
  <redoc spec-url="/v1/openapi.json" hide-loading></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>
`;

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=300, s-maxage=300');
  res.setHeader('x-content-type-options', 'nosniff');
  return res.status(200).send(HTML);
}
