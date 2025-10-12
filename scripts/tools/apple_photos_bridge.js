#!/usr/bin/env node
// Apple Photos Bridge (macOS only)
// Simple HTTP server that lists Apple Photos albums and items via JXA (osascript -l JavaScript)
// Run: node scripts/tools/apple_photos_bridge.js

const http = require('http');
const { execFile } = require('child_process');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 8787;
const tmpDir = path.join(os.tmpdir(), 'nuke-photos-bridge');
try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

function jxa(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', script], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout || 'null')); } catch (e) { reject(e); }
    });
  });
}

function exportItems(ids) {
  const dest = tmpDir;
  const idList = (ids || []).map(id => `'${String(id).replace(/'/g, "\\'")}'`).join(',');
  const script = `
  (() => {
    const Photos = Application('Photos');
    Photos.includeStandardAdditions = true;
    const ids = [${idList}];
    const all = Photos.mediaItems();
    const toExport = all.filter(m => ids.includes(String(m.id())));
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const dest = '${dest.replace(/'/g, "\\'")}';
    try { app.doShellScript('mkdir -p ' + dest); } catch(e) {}
    Photos.export(toExport, { to: Path(dest), with: 'using originals' });
    const out = toExport.map(m => ({ id: String(m.id()), filename: m.filename(), creationDate: (m.date()||null) && m.date().toISOString() }));
    return JSON.stringify({ files: out, base: dest });
  })();`;
  return jxa(script);
}

function listAlbums() {
  const script = `
  (() => {
    const Photos = Application('Photos');
    Photos.includeStandardAdditions = true;
    const result = Photos.albums().map(a => ({ id: String(a.id()), name: a.name(), count: a.mediaItems().length }));
    return JSON.stringify({ albums: result });
  })();`;
  return jxa(script);
}

function listItems(albumId) {
  const script = `
  (() => {
    const Photos = Application('Photos');
    Photos.includeStandardAdditions = true;
    let items = [];
    const all = Photos.albums().filter(a => String(a.id()) === '${albumId}');
    if (all.length > 0) {
      const media = all[0].mediaItems();
      items = media.map(m => ({ id: String(m.id()), name: m.filename(), creationDate: (m.date() || null) && m.date().toISOString(), thumbUrl: '/thumb/' + encodeURIComponent(String(m.id())) }));
    }
    return JSON.stringify({ items });
  })();`;
  return jxa(script);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  try {
    // Serve exported files statically from tmpDir
    const parsed = url.parse(req.url);
    if (parsed.pathname && parsed.pathname.startsWith('/tmp/')) {
      const rel = parsed.pathname.replace('/tmp/', '');
      const filePath = path.join(tmpDir, rel);
      if (fs.existsSync(filePath)) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    if (req.url === '/albums') {
      const data = await listAlbums();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return;
    }
    const m = req.url.match(/^\/albums\/([^\/]+)$/);
    if (m) {
      const albumId = decodeURIComponent(m[1]);
      const data = await listItems(albumId);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return;
    }
    // Generate and serve thumbnail for a media item id
    const mt = req.url.match(/^\/thumb\/([^\/]+)$/);
    if (mt && req.method === 'GET') {
      const id = decodeURIComponent(mt[1]);
      const thumbsDir = path.join(tmpDir, 'thumbs');
      try { fs.mkdirSync(thumbsDir, { recursive: true }); } catch {}
      const outThumb = path.join(thumbsDir, `${id}.jpg`);
      if (!fs.existsSync(outThumb)) {
        const exportDir = path.join(tmpDir, `thumb-src-${id}`);
        try { fs.mkdirSync(exportDir, { recursive: true }); } catch {}
        const exportScript = `
        (() => {
          const Photos = Application('Photos');
          Photos.includeStandardAdditions = true;
          const all = Photos.mediaItems();
          const items = all.filter(m => String(m.id()) === '${id.replace(/'/g, "\\'")}');
          if (items.length === 0) return JSON.stringify({ ok: false });
          const app = Application.currentApplication();
          app.includeStandardAdditions = true;
          Photos.export(items, { to: Path('${exportDir.replace(/'/g, "\\'")}'), with: 'using current' });
          return JSON.stringify({ ok: true });
        })();`;
        await jxa(exportScript);
        const files = fs.readdirSync(exportDir).filter(f => !f.startsWith('.'));
        if (files.length === 0) { res.statusCode = 404; return res.end('No export'); }
        const first = path.join(exportDir, files[0]);
        await new Promise((resolve, reject) => {
          execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', '-Z', '400', first, '--out', outThumb], (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }
      if (!fs.existsSync(outThumb)) { res.statusCode = 404; return res.end('No thumb'); }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/jpeg');
      fs.createReadStream(outThumb).pipe(res);
      return;
    }
    if (req.url === '/export' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', async () => {
        const parsed = JSON.parse(body || '{}');
        const ids = parsed.ids || [];
        const data = await exportItems(ids);
        const files = (data.files || []).map(f => ({
          id: f.id,
          filename: f.filename,
          creationDate: f.creationDate,
          url: `/tmp/${encodeURIComponent(f.filename)}`
        }));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ files }));
      });
      return;
    }
    res.statusCode = 404;
    res.end('Not Found');
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String(e && e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`Apple Photos Bridge running on http://localhost:${PORT}`);
});
