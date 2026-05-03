// Vercel serverless function — public OpenAPI documentation page.
// Routes:
//   /api/docs           → this handler (Redoc HTML)
//   /v1/openapi.json    → static mirror at nuke_frontend/api/v1/openapi.json
//
// External agents fetch /v1/openapi.json directly. Humans hit /api/docs.
//
// CSP NOTE (coordination request for WS-B): the inline <redoc> custom element
// loads its bundle from https://cdn.redoc.ly. The current vercel.json CSP
// `script-src 'self' 'unsafe-inline' https://unpkg.com https://js.stripe.com`
// must be extended with `https://cdn.redoc.ly`. Redoc also pulls font CSS,
// so style-src needs the same host. See WS-A final report.

export const config = { runtime: 'edge' };

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

export default async function handler(_req: Request): Promise<Response> {
  return new Response(HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
