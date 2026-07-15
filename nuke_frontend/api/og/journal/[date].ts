import type { VercelRequest, VercelResponse } from '@vercel/node';

// GET /api/og/journal/:date — crawler-only OG shim for the day-receipt page.
// nuke_frontend/vercel.json rewrites /journal/:date here when the user-agent
// is a link-preview bot (iMessage masquerades as facebookexternalhit/Facebot/
// Twitterbot). Humans never hit this route: they fall through to the SPA
// catchall and get index.html, so client navigation is untouched.
//
// v1 is text-only: og:title "SAT AUG 24 2024 — 60 photos — 1977 Chevrolet
// Blazer", og:description first/last/span, og:url. No og:image yet.
//
// DEPLOYED UNIVERSE: must live in nuke_frontend/api/ — deploys run
// `vercel deploy` from ./nuke_frontend, so repo-root api/ never ships.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = 'America/Los_Angeles'; // shop timezone for human-readable times

async function rest(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status}`);
  return r.json();
}

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

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = req.query.date;
  const date = Array.isArray(raw) ? raw[0] : raw;
  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  let title = `${dayLabel(date)} — Nuke journal`;
  let description = 'Shop day receipt on nuke.ag.';

  try {
    const photos = await rest(
      `vehicle_images?select=vehicle_id,taken_at` +
        `&taken_at=gte.${date}T00:00:00Z&taken_at=lte.${date}T23:59:59Z` +
        `&order=taken_at.asc&limit=200`,
    );

    if (photos.length > 0) {
      const count = photos.length === 200 ? '200+' : String(photos.length);
      const noun = photos.length === 1 ? 'photo' : 'photos';

      // most-photographed vehicle that day
      const tally = new Map<string, number>();
      for (const p of photos) {
        if (p.vehicle_id) tally.set(p.vehicle_id, (tally.get(p.vehicle_id) || 0) + 1);
      }
      let vehicleLabel = '';
      const topId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topId) {
        const [v] = await rest(`vehicles?id=eq.${topId}&select=year,make,model&limit=1`);
        if (v) vehicleLabel = [v.year, v.make, v.model].filter(Boolean).join(' ');
      }

      title = `${dayLabel(date)} — ${count} ${noun}${vehicleLabel ? ` — ${vehicleLabel}` : ''}`;

      const first = photos[0].taken_at;
      const last = photos[photos.length - 1].taken_at;
      if (first && last) {
        const spanMin = Math.round((new Date(last).getTime() - new Date(first).getTime()) / 60000);
        const span =
          spanMin >= 60 ? `${Math.floor(spanMin / 60)}h ${spanMin % 60}m` : `${spanMin}m`;
        description = `First photo ${clock(first)} · last ${clock(last)} · ${span} span.`;
      }
    } else {
      description = `No shop activity recorded for ${dayLabel(date)}.`;
    }
  } catch {
    // serve generic tags rather than a 5xx — a degraded preview beats none
  }

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
