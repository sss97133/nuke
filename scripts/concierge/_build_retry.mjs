// Retry queue: the rows the sweep left unfinished for OUR reasons, not the business's.
//   RETRY_slow_site   — transport timed out / engines failed / tunnel refused. Recoverable.
//   RETRY_dns         — DNS did not resolve. Re-witnessed once; if it fails again the
//                       domain really is gone and NULL is the honest answer.
//   RETRY_gate_generic— an all-generic org name left the gate no distinctive token to match.
//   RETRY_about_hop   — gate PASSED (own_site) but the homepage stated nothing about the
//                       business; the about-page hop can reach the statement.
// Orgs sharing one website are collapsed into a single job via `also` so the site is
// fetched once and the verdict is taken per-org.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const decode = (s) => (s || '').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
const fold = (s) => decode(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const GENERIC = /^(the|and|les|des|del|saint|st|barth|barths|barthelemy|sbh|sas|sarl|inc|ltd|llc|group|groupe|restaurant|restaurants|bar|cafe|hotel|villa|villas|boutique|shop|store|beach|club|jewelry|jewellery|bijouterie|chef|chefs|prive|events|event|architectures|architecture|architectes|design|studio|rental|rentals|real|estate|immobilier|agence|agency|services|service|company|maison|island|caraibes|france|paris|official|site|home|gustavia)$/;
const tokens = (s) => fold(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !GENERIC.test(t));

const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > -1 ? new Set(process.argv[i + 1].split(',')) : null; })();

// PostgREST hard-caps at 1000 rows; paginate or you read a third of the table and believe it.
async function pagedAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const data = await pagedAll(() => db
  .from('organizations')
  .select('id, name, slug, website, description, metadata')
  .eq('metadata->>project', 'lofficiel-concierge')
  .not('metadata->site', 'is', null)
  .order('id'));

const RETRYABLE = /timed out|timeout|All scraping engines failed|ERR_TUNNEL|ERR_CONNECTION|ECONNRESET|socket hang up|rate limit|429|http 5\d\d/i;
const DNS = /DNS resolution failed|ENOTFOUND|could not be resolved/i;

const jobs = [];
for (const o of data) {
  const g = o.metadata?.site?.entity_gate;
  if (!g || !o.website) continue;
  if (o.description) continue;                       // already stated — nothing to retry for
  const reason = g.reason || '';
  let tier = null;
  if (g.verdict === 'unreachable' && DNS.test(reason)) tier = 'RETRY_dns';
  else if (g.verdict === 'unreachable' && RETRYABLE.test(reason)) tier = 'RETRY_slow_site';
  else if (['mismatch', 'name_drift'].includes(g.verdict) && tokens(o.name).length === 0) tier = 'RETRY_gate_generic';
  else if (g.verdict === 'own_site') tier = 'RETRY_about_hop';
  if (!tier) continue;
  if (ONLY && !ONLY.has(tier)) continue;
  jobs.push({ id: o.id, name: decode(o.name), slug: o.slug, website: o.website, tier, also: [] });
}

// collapse orgs that share one website — fetch once, adjudicate per org
const byUrl = new Map();
for (const j of jobs) {
  const k = j.website.replace(/\/+$/, '').toLowerCase();
  if (!byUrl.has(k)) byUrl.set(k, j);
  else byUrl.get(k).also.push({ id: j.id, name: j.name, slug: j.slug });
}
const rows = [...byUrl.values()];

fs.writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
const by = {};
for (const r of rows) by[r.tier] = (by[r.tier] || 0) + 1;
console.error(JSON.stringify(by, null, 2));
console.error(`\n${rows.length} fetch jobs covering ${jobs.length} org rows`);
