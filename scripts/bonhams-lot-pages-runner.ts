// Bonhams lot-page deep pass, run from a house address (Bonhams answers 403 to the edge function's address).
// Reads the next landed lots from extract-bonhams (deep_queue), fetches each lot page ONE PER 2 SECONDS, parses it with the
// same parseLotPage the edge function would use, and sends the parsed pages back (land_lot_pages), which writes them.
// Stops at once on 403/429 or a page that is not a lot page (a challenge); marks nothing in that case.
// Run: dotenvx run -- deno run --allow-net --allow-env scripts/bonhams-lot-pages-runner.ts [max_lots]
import { parseLotPage } from '../supabase/functions/extract-bonhams/lotPage.ts';

const BASE = 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-bonhams';
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX = Number(Deno.args[0]) || 200;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(body: unknown): Promise<any> {
  const res = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
  return await res.json();
}

let done = 0;
while (done < MAX) {
  const q = await call({ action: 'deep_queue', limit: 20 });
  const lots: Array<{ vehicle_id: string; source_url: string; source_listing_id: string }> = q.lots ?? [];
  if (!lots.length) { console.log('queue empty'); break; }
  const pages: unknown[] = [];
  for (const lot of lots) {
    await sleep(2000);
    const res = await fetch(lot.source_url.replace(/\/?$/, '/'), { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (res.status === 403 || res.status === 429) { console.log(`STOP: HTTP ${res.status} on ${lot.source_listing_id}`); Deno.exit(2); }
    if (res.status === 404 || res.status === 410) { pages.push({ ...lot, status: `http_${res.status}` }); continue; }
    if (res.status !== 200) { console.log(`skip ${lot.source_listing_id}: HTTP ${res.status}`); continue; }
    const page = parseLotPage(await res.text());
    if (!page) { console.log(`STOP: not a lot page (challenge or changed shape) on ${lot.source_listing_id}`); Deno.exit(3); }
    pages.push({ ...lot, page });
  }
  const r = await call({ action: 'land_lot_pages', pages });
  done += pages.length;
  console.log(new Date().toISOString(), `sent ${pages.length}`, JSON.stringify({ done: r.done, gone: r.gone, images: r.images, failed: r.failed, errors: r.errors }));
  if (r.failed > 5) { console.log('STOP: too many failed writes'); Deno.exit(4); }
  await sleep(30000); // leave the database room between rounds
}
console.log('finished', done);
