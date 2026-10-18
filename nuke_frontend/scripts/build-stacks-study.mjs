// Node >=22.18 (native TypeScript stripping). Anonymous SELECTs only; never runs in a build or job.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/lib/env.ts';
import { encodeStudy, makeStudy } from '../src/pages/stacks/bidMeasurements.ts';
import { capturePopulation, populationReader, sqlPopulationReader } from './stacks-population-capture.mjs';
import { analyzePopulation } from './stacks-study-query.mjs';

const args = process.argv.slice(2), argument = name => args.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
// Offline inspection returns before constructing the source client or creating capture directories.
if (args.includes('--analyze')) {
  console.log(JSON.stringify(await analyzePopulation(args)));
  process.exit(0);
}
if (args.includes('--population') && (!argument('--cache') || !argument('--output'))) throw new Error('Full-population mode requires explicit private --cache and --output paths.');
if (args.includes('--population') && args.some(a => !['--population','--select-only','--refresh-method'].includes(a)
  && !['--cache=','--output=','--from=','--before=','--requests=','--sql-reader=','--parent-page-size='].some(prefix => a.startsWith(prefix)))) throw new Error('Unknown full-population option.');
const cache = argument('--cache') || path.join(os.tmpdir(), `nuke-stacks-study-${Date.now()}`);
const output = argument('--output') || fileURLToPath(new URL('../public/stacks/bid-study-v1.json', import.meta.url));
fs.mkdirSync(cache, { recursive:true });
const publicKey = process.env.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
if (publicKey.startsWith('sb_secret_')) throw new Error('This producer refuses secret API keys.');
if (publicKey.startsWith('eyJ') && JSON.parse(Buffer.from(publicKey.split('.')[1],'base64url')).role !== 'anon') throw new Error('This producer accepts only the public anonymous role.');
const db = createClient(process.env.VITE_SUPABASE_URL || SUPABASE_URL,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
const lotSelect = 'id,vehicle_id,source,source_url,auction_end_date,total_bids,winning_bid,winning_bidder_external_identity_id,vehicles!inner(id,year,make,model,normalized_model)';
const bidSelect = 'id,auction_event_id,vehicle_id,source_url,posted_at,created_at,bid_amount,external_identity_id,bat_comment_id,author_username,vehicles!inner(id)';
const gate = q => q.eq('vehicles.is_public',true).is('vehicles.deleted_at',null).or('listing_kind.is.null,listing_kind.neq.non_vehicle_item',{referencedTable:'vehicles'});
const readCache = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null;
if (args.includes('--population')) {
  let lastProgress = 0;
  const queryReader = argument('--sql-reader');
  if (queryReader && !path.isAbsolute(queryReader)) throw new Error('--sql-reader requires the absolute path to the existing trusted q.sh.');
  const reader = queryReader ? sqlPopulationReader(async query => {
    const result = await promisify(execFile)('bash', [queryReader, query], { timeout:65_000, maxBuffer:16 * 1024 * 1024 });
    return result.stdout;
  }) : populationReader(db);
  const result = await capturePopulation({ cache, output, reader,
    from:argument('--from'), before:argument('--before'), maxRequests:Number(argument('--requests') ?? 100), selectOnly:args.includes('--select-only'), refreshMethod:args.includes('--refresh-method'),
    parentPageSize:argument('--parent-page-size') ? Number(argument('--parent-page-size')) : undefined,
    onProgress:receipt => { if (Date.now() - lastProgress >= 5000) { console.log(JSON.stringify(receipt)); lastProgress = Date.now(); } },
  });
  console.log(JSON.stringify(result));
  process.exitCode = result.complete ? 0 : 2;
} else {
const manifestFile = path.join(cache,'capture.json');
const oldFiles = fs.readdirSync(cache).filter(f => /^public-study-(candidates|bids)-.+\.json$/.test(f));
if (oldFiles.length && !fs.existsSync(manifestFile) && !args.includes('--adopt-retained')) throw new Error('Existing capture needs its manifest. --adopt-retained records cache-file times explicitly; it does not claim a new read.');
const times = oldFiles.map(f => fs.statSync(path.join(cache,f)).mtimeMs);
const original = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile,'utf8')) : {
  contract:1, selectionEnd:new Date(times.length ? Math.max(...times) : Date.now()).toISOString(),
  startedAt:new Date(times.length ? Math.min(...times) : Date.now()).toISOString(), completedAt:times.length ? new Date(Math.max(...times)).toISOString() : null,
  clockBasis:times.length ? 'Retained cache-file completion times; no new source read.' : 'Sequential public API capture, not an atomic point-in-time snapshot.',
};
if (original.contract !== 1) throw new Error('This cache is a population capture, not a legacy sample. Use --population.');
const cutoff = Date.parse(original.selectionEnd), lastYear = new Date(cutoff).getUTCFullYear();
const candidates = []; let capped = false, madeRead = false;
for (let year = 2016; year <= lastYear; year++) {
  for (let quarter = 0; quarter < 4; quarter++) {
    const from = Date.UTC(year,quarter * 3,1), to = Math.min(Date.UTC(year,quarter * 3 + 3,1),cutoff);
    if (from >= to) continue;
    const file = path.join(cache,`public-study-candidates-${year}-${quarter}.json`); let rows = readCache(file);
    if (!rows) {
      const result = await gate(db.from('auction_events').select(lotSelect).in('source',['bat','bringatrailer']).eq('outcome','sold')
        .gte('auction_end_date',new Date(from).toISOString()).lt('auction_end_date',new Date(to).toISOString()))
        .order('auction_end_date',{ascending:false}).order('id').limit(33);
      if (result.error || !Array.isArray(result.data)) throw new Error(`Public candidate read failed for ${year}, quarter ${quarter + 1}.`);
      rows = result.data; fs.writeFileSync(file,JSON.stringify(rows)); madeRead = true;
    }
    if (rows.length > 32) capped = true;
    candidates.push(...rows.slice(0,32));
  }
}
const unique = [...new Map(candidates.map(l => [l.id,l])).values()], bids = [];
for (let i = 0; i < unique.length; i += 40) {
  const ids = unique.slice(i,i + 40).map(l => l.id), allowed = new Set(ids);
  const file = path.join(cache,`public-study-bids-${i}.json`); let rows = readCache(file);
  if (!rows) {
    rows = []; let after = null, complete = false;
    for (let page = 0; page < 8; page++) {
      let query = gate(db.from('auction_comments').select(bidSelect).in('auction_event_id',ids).eq('comment_type','bid').gt('bid_amount',0)).order('id').limit(1000);
      if (after) query = query.gt('id',after);
      const result = await query;
      if (result.error || !Array.isArray(result.data)) throw new Error('Public bid sequence read failed; no partial study is published.');
      if (!result.data.length) {complete = true; break;}
      for (const b of result.data) {if (!b.id || (after && b.id <= after)) throw new Error('Unstable bid-page continuation.'); rows.push(b); after = b.id;}
    }
    if (!complete) throw new Error('Bounded complete-sequence read exceeded; no partial study is published.');
    fs.writeFileSync(file,JSON.stringify(rows)); madeRead = true;
  }
  if (rows.some(b => !allowed.has(b.auction_event_id))) throw new Error('Cache batch does not match the selected episodes. Use a new capture directory.');
  bids.push(...rows);
}
const completedAt = madeRead ? new Date().toISOString() : original.completedAt;
if (!completedAt) throw new Error('Capture completion clock is unavailable.');
const manifest = {...original,completedAt,clockBasis:madeRead ? 'Sequential public API capture, possibly resumed with retained inputs; not an atomic point-in-time snapshot.' : original.clockBasis}; fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
const study = makeStudy(unique,bids,completedAt,
  `Quarter-stratified retained study: up to 32 most recently closed public sold BaT episodes per calendar quarter, 2016–${lastYear}; close selection ends ${original.selectionEnd}. This is a bounded captured sample, not a market census or probability sample.`,capped);
study.knowledgeMode += ` Capture: ${original.startedAt} through ${completedAt}. ${manifest.clockBasis}`;
fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify(encodeStudy(study)));
console.log(JSON.stringify({cache,output,candidates:study.candidateN,eligible:study.lots.length,bids:study.lots.reduce((n,l) => n + l.sums.bids,0),captureCompletedAt:completedAt,usedCachedInputs:!madeRead,bytes:fs.statSync(output).size}));
}
