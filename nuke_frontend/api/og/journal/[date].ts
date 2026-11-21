import type { VercelRequest, VercelResponse } from '@vercel/node';

// GET /api/og/journal/:date — crawler-only OG shim for the day-receipt page.
// nuke_frontend/vercel.json rewrites /journal/:date here when the user-agent
// is a link-preview bot (iMessage masquerades as facebookexternalhit/Facebot/
// Twitterbot). Humans never hit this route: they fall through to the SPA
// catchall and get index.html, so client navigation is untouched.
//
// The preview is a logged-out read, so it says only what a logged-out visitor may know without a database read:
// the day and the site. It reads nothing: a day's photo count, first/last times and top vehicle come from a scan
// that has no visitor reader yet, and a preview must never be built from rows a visitor cannot read. og:title
// "SAT AUG 24 2024 — Nuke journal", og:description generic, og:url. No og:image.
//
// DEPLOYED UNIVERSE: must live in nuke_frontend/api/ — deploys run
// `vercel deploy` from ./nuke_frontend, so repo-root api/ never ships.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// "2024-08-24" -> "SAT AUG 24 2024"
function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const wk = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const mo = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${wk} ${mo} ${d.getUTCDate()} ${d.getUTCFullYear()}`.toUpperCase();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = req.query.date;
  const date = Array.isArray(raw) ? raw[0] : raw;
  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const title = `${dayLabel(date)} — Nuke journal`;
  const description = 'Shop day receipt on nuke.ag.';

  const url = `https://nuke.ag/journal/${date}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nuke">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
</head>
<body>
<p>${esc(title)}</p>
<p>${esc(description)}</p>
<p><a href="${esc(url)}">${esc(url)}</a></p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(html);
}
