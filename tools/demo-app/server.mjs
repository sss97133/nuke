import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.VITE_SUPABASE_URL + '/functions/v1';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = 3333;

const html = readFileSync(join(__dir, 'index.html'), 'utf8');

const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  if (req.url === '/makes') {
    try {
      const pgUrl = `${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_vehicle_makes`;
      const r = await fetch(pgUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KEY}`,
          'apikey': process.env.VITE_SUPABASE_ANON_KEY || KEY,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      if (r.ok) {
        const data = await r.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } else {
        // Fallback: query directly
        const r2 = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/vehicles?select=make&is_public=eq.true&make=not.is.null&order=make&limit=1`, {
          headers: { 'Authorization': `Bearer ${KEY}`, 'apikey': KEY },
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  if (req.url.startsWith('/api/')) {
    const endpoint = req.url.slice(5); // strip /api/
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const upstream = await fetch(`${API_BASE}/${endpoint}`, {
        headers: { 'Authorization': `Bearer ${KEY}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await upstream.json();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`\n  Nuke API Demo → http://localhost:${PORT}\n`);
});
