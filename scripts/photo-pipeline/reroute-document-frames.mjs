#!/usr/bin/env node
// Re-run the photo pipeline's document route for frames that failed while receipt-photo-ocr did not exist
// (route_result "receipt-photo-ocr: failed (... 404 ...)"). Calls the deployed function once per frame with the
// service key; the function does the work (OCR worker, private copy, capture_document_pages, land_document_pages).
//
//   dotenvx run -q -f ~/nuke/.env -- node scripts/photo-pipeline/reroute-document-frames.mjs --owner <uuid> [--limit N] [--dry-run] [--out receipt.json]
//
// Nothing here writes to the database; the function's writers do.
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (run under dotenvx)'); process.exit(2); }
if (!args.owner || args.owner === true) { console.error('--owner <uuid> is required'); process.exit(2); }
const limit = args.limit && args.limit !== true ? Number(args.limit) : 1000;
const dry = args['dry-run'] === true;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const list = async () => {
  const q = `vehicle_images?select=id,vehicle_id,taken_at,ai_scan_metadata->>route_result&user_id=eq.${args.owner}` +
    `&ai_scan_metadata->>route_result=like.receipt-photo-ocr:%20failed*&order=taken_at.desc.nullslast&limit=${limit}`;
  const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: H });
  if (!r.ok) throw new Error(`list: ${r.status} ${await r.text()}`);
  return r.json();
};

const route = async (id) => {
  const r = await fetch(`${URL_}/functions/v1/receipt-photo-ocr`, { method: 'POST', headers: H, body: JSON.stringify({ image_id: id }) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
  return { http: r.status, ...j };
};

const frames = await list();
console.error(`${frames.length} frames to re-route for ${args.owner}${dry ? ' (dry run: listing only)' : ''}`);
const out = [];
const summary = { frames: frames.length, page: 0, landed: 0, waiting_no_vehicle: 0, vehicle_document: 0, errors: 0, by_type: {} };
if (!dry) {
  let i = 0;
  const worker = async () => {
    while (i < frames.length) {
      const f = frames[i++];
      try {
        const res = await route(f.id);
        out.push({ image_id: f.id, vehicle_id: f.vehicle_id, ...res });
        if (res.page) summary.page++;
        if (res.landed) summary.landed++;
        else if (/no vehicle/.test(res.reason || '')) summary.waiting_no_vehicle++;
        else if (/vehicle document/.test(res.reason || '')) summary.vehicle_document++;
        if (res.error || res.http >= 400) summary.errors++;
        if (res.document_type) summary.by_type[res.document_type] = (summary.by_type[res.document_type] || 0) + 1;
        console.error(`${f.id} ${res.http} ${res.document_type || '-'} ${res.landed ? 'landed ' + res.receipt_id : (res.reason || res.error || '')}`);
      } catch (e) {
        summary.errors++;
        out.push({ image_id: f.id, error: String(e.message || e) });
        console.error(`${f.id} ERROR ${e.message || e}`);
      }
    }
  };
  await Promise.all([worker(), worker()]);
}
const receipt = { run: 'capture-document-route reroute', at: new Date().toISOString(), owner: args.owner, summary, results: out };
if (args.out && args.out !== true) { const { writeFileSync } = await import('node:fs'); writeFileSync(args.out, JSON.stringify(receipt, null, 1)); }
console.log(JSON.stringify(summary));
