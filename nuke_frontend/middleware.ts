/**
 * Vercel Edge Middleware
 *
 * Runs on every request BEFORE static file serving.
 * For /market/competitors: injects page-specific OG meta tags into
 * the base index.html so link previews (Twitter, LinkedIn, iMessage,
 * Slack) show the right title/description instead of the generic ones.
 *
 * All other routes pass through untouched.
 */

export const config = {
  matcher: '/market/competitors',
};

const OG = {
  title:       'Nuke vs. Rally vs. TheCarCrowd — Fractional Vehicle Ownership Compared',
  description: 'Every fractional car platform compared: Rally (9 cars), TheCarCrowd (40+ cars, UK, FCA), Fraction Motors (Solana). Nuke has real transaction data on 1.25M vehicles. No one else does.',
  url:         'https://nuke.ag/market/competitors',
};

export default async function middleware(request: Request): Promise<Response> {
  // Fetch the root index.html (internal fetch bypasses middleware)
  const rootUrl = new URL('/', request.url).toString();
  const base    = await fetch(rootUrl);
  let   html    = await base.text();

  // Swap out every generic OG/Twitter tag with page-specific ones
  html = html
    .replace(
      /<title>[^<]*<\/title>/,
      `<title>${OG.title}</title>`,
    )
    .replace(
      /<meta name="description" content="[^"]*"\s*\/>/,
      `<meta name="description" content="${OG.description}" />`,
    )
    .replace(
      /<meta property="og:title" content="[^"]*"\s*\/>/,
      `<meta property="og:title" content="${OG.title}" />`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*"\s*\/>/,
      `<meta property="og:description" content="${OG.description}" />`,
    )
    .replace(
      /<meta property="og:url" content="[^"]*"\s*\/>/,
      `<meta property="og:url" content="${OG.url}" />`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*"\s*\/>/,
      `<meta name="twitter:title" content="${OG.title}" />`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*"\s*\/>/,
      `<meta name="twitter:description" content="${OG.description}" />`,
    );

  return new Response(html, {
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
