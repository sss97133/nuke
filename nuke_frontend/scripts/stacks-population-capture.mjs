// Full-population mode of build-stacks-study. Public database SELECTs only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BID_METHOD, encodeStudy, makeStudy } from '../src/pages/stacks/bidMeasurements.ts';

const CONTRACT = 'public-bid-population-capture-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = message => { throw new Error(message); };
const iso = value => {
  const time = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(time)) fail('Invalid population clock.');
  return new Date(time).toISOString();
};
const gate = q => q.eq('vehicles.is_public', true).is('vehicles.deleted_at', null)
  .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item', { referencedTable: 'vehicles' });
const parentFields = 'id,vehicle_id,source,source_url,auction_end_date,created_at,total_bids,winning_bid,winning_bidder_external_identity_id,vehicles!inner(id,year,make,model,normalized_model,is_public,deleted_at,listing_kind)';
const bidFields = 'id,auction_event_id,vehicle_id,source_url,posted_at,created_at,bid_amount,external_identity_id,bat_comment_id,author_username,vehicles!inner(id,is_public,deleted_at,listing_kind)';

/** Same public-parent gates on both levels; no privileged client is constructed here. */
export function populationReader(db) {
  const finish = async q => {
    const result = await q.abortSignal(AbortSignal.timeout(30_000));
    if (result.error || !Array.isArray(result.data)) {
      const error = new Error('Public population page could not be read; retained progress is incomplete.');
      error.code = result.error?.code;
      throw error;
    }
    return result.data;
  };
  return {
    parents: ({ scope, after, limit = 500 }) => {
      let q = gate(db.from('auction_events').select(parentFields))
        .in('source', scope.sources).eq('outcome', 'sold')
        .gte('auction_end_date', scope.from).lt('auction_end_date', scope.before)
        .lt('created_at', scope.before).order('id').limit(limit);
      if (after) q = q.gt('id', after);
      return finish(q);
    },
    bids: ({ scope, ids, after }) => {
      let q = gate(db.from('auction_comments').select(bidFields))
        .in('auction_event_id', ids).eq('comment_type', 'bid').gt('bid_amount', 0)
        .lt('created_at', scope.before).order('id').limit(1000);
      if (after) q = q.gt('id', after);
      return finish(q);
    },
  };
}

/** Operator transport through the existing q.sh; SQL still runs under anon RLS. */
export function sqlPopulationReader(readQuery) {
  const prefix = `SET LOCAL ROLE anon; SET LOCAL "request.jwt.claims"='{"role":"anon"}'; SET LOCAL "request.jwt.claim.sub"=''; SET LOCAL "request.jwt.claim.role"='anon'; `;
  const eligibility = `v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'`;
  const metadata = `jsonb_build_object('id',v.id,'is_public',v.is_public,'deleted_at',v.deleted_at,'listing_kind',v.listing_kind`;
  const clock = value => `'${iso(value)}'::timestamptz`;
  const key = value => { if (!UUID.test(value)) fail('Invalid public reader UUID.'); return `'${value}'::uuid`; };
  const read = async select => {
    const sql = `${prefix}SELECT jsonb_build_object('role',current_user,'requestRole',auth.role(),'userId',auth.uid(),'rows',(SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (${select})t)) page;`;
    const response = await readQuery(sql);
    const result = typeof response === 'string' ? JSON.parse(response) : response;
    if (!Array.isArray(result) || result.length !== 1) {
      const error = new Error('Sanctioned public SQL page could not be read.');
      error.code = /57014/.test(result?.message ?? '') ? '57014' : 'public_sql_read_failed';
      throw error;
    }
    const page = result[0].page;
    if (page?.role !== 'anon' || page.requestRole !== 'anon' || page.userId !== null || !Array.isArray(page.rows)) fail('SQL transport did not prove anonymous RLS context.');
    return page.rows;
  };
  return {
    parents: ({ scope, after, limit = 500 }) => {
      if (!same(scope.sources, ['bat','bringatrailer']) || !Number.isInteger(limit) || limit < 25 || limit > 500) fail('Invalid public SQL population scope.');
      return read(`SELECT ae.id,ae.vehicle_id,ae.source,ae.source_url,ae.auction_end_date,ae.created_at,ae.total_bids,ae.winning_bid,ae.winning_bidder_external_identity_id,
        ${metadata},'year',v.year,'make',v.make,'model',v.model,'normalized_model',v.normalized_model) vehicles
        FROM public.auction_events ae JOIN public.vehicles v ON v.id=ae.vehicle_id
        WHERE ae.source IN ('bat','bringatrailer') AND ae.outcome='sold' AND ae.auction_end_date>=${clock(scope.from)} AND ae.auction_end_date<${clock(scope.before)}
          AND ae.created_at<${clock(scope.before)} AND ${eligibility}${after ? ` AND ae.id>${key(after)}` : ''}
        ORDER BY ae.id LIMIT ${limit}`);
    },
    bids: ({ scope, ids, after }) => {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 40) fail('Invalid public SQL child batch.');
      return read(`SELECT ac.id,ac.auction_event_id,ac.vehicle_id,ac.source_url,ac.posted_at,ac.created_at,ac.bid_amount,ac.external_identity_id,ac.bat_comment_id,ac.author_username,
        ${metadata}) vehicles FROM public.auction_comments ac JOIN public.vehicles v ON v.id=ac.vehicle_id
        WHERE ac.auction_event_id=ANY(ARRAY[${ids.map(key).join(',')}]) AND ac.comment_type='bid' AND ac.bid_amount>0
          AND ac.created_at<${clock(scope.before)} AND ${eligibility}${after ? ` AND ac.id>${key(after)}` : ''}
        ORDER BY ac.id LIMIT 1000`);
    },
  };
}

async function atomic(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { mode: 0o600 });
  await fs.rename(temporary, file);
}
async function privatePath(file, directory = false) {
  const resolved = path.resolve(file);
  if (directory) await fs.mkdir(resolved, { recursive: true, mode: 0o700 });
  else await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const parent = await fs.realpath(directory ? resolved : path.dirname(resolved));
  const relative = path.relative(ROOT, parent);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    fail('Population inputs and review output must stay outside the public checkout.');
  }
  return directory ? parent : path.join(parent, path.basename(resolved));
}
function validateRows(rows, after, kind, scope, allowed) {
  if (!Array.isArray(rows) || rows.length > (kind === 'parents' ? 500 : 1000)) fail('Invalid retained page size.');
  let cursor = after;
  for (const row of rows) {
    if (!UUID.test(row.id) || (cursor && row.id <= cursor)) fail('Population pagination did not preserve the primary-key boundary.');
    cursor = row.id;
    const v = row.vehicles;
    if (!UUID.test(row.vehicle_id) || v?.id !== row.vehicle_id || v.is_public !== true
      || v.deleted_at !== null || v.listing_kind === 'non_vehicle_item') fail('Population page violated the public parent boundary.');
    if (!Number.isFinite(Date.parse(row.created_at)) || Date.parse(row.created_at) >= Date.parse(scope.before)) fail('Population page exceeded its recorded creation cutoff.');
    if (kind === 'parents') {
      const end = Date.parse(row.auction_end_date);
      if (!scope.sources.includes(row.source) || !Number.isFinite(end)
        || end < Date.parse(scope.from) || end >= Date.parse(scope.before)) fail('Population page changed the declared close-window scope.');
    } else if (!allowed.has(row.auction_event_id)) fail('Retained bid page belongs to a different parent batch.');
  }
  return cursor;
}

/** Request bounds interrupt work, never truncate the resulting analytical population. */
export async function capturePopulation(options) {
  if (!options.cache || !options.output) fail('Full-population mode requires explicit private --cache and --output paths.');
  const cache = await privatePath(options.cache, true), lockFile = path.join(cache, 'capture.lock');
  let lock;
  try { lock = await fs.open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    if (owner.host !== hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) fail('Capture lock needs operator inspection.');
    try { process.kill(owner.pid, 0); fail('Another capture process is still live.'); }
    catch (status) { if (status.code !== 'ESRCH') throw status; }
    await fs.unlink(lockFile); // Positive process-missing evidence, not an expired timestamp.
    lock = await fs.open(lockFile, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
  await lock.close();
  try { return await captureUnlocked({ ...options, cache }); }
  finally { await fs.unlink(lockFile); }
}

async function captureUnlocked({ cache, output, reader, from, before, maxRequests = 100, selectOnly = false, refreshMethod = false, parentPageSize, onProgress = () => {} }) {
  if (!cache || !output) fail('Full-population mode requires explicit private --cache and --output paths.');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) fail('Request budget must be an integer from 1 through 1000.');
  cache = await privatePath(cache, true);
  output = await privatePath(output);
  if (path.dirname(output) === cache && /^(capture\.(json|lock)|page-.*\.json)$/.test(path.basename(output))) fail('Output cannot replace capture evidence.');
  const manifestFile = path.join(cache, 'capture.json');
  let m;
  try { m = JSON.parse(await fs.readFile(manifestFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const foldSource = await fs.readFile(new URL('../src/pages/stacks/bidMeasurements.ts', import.meta.url), 'utf8');
  const boundary = foldSource.indexOf('\nfunction scopeSums(');
  if (boundary < 0) fail('Canonical fold source boundary changed.');
  const foldHash = hash(foldSource.slice(0, boundary));
  const scope = { sources: ['bat', 'bringatrailer'], outcome: 'sold',
    from: iso(from ?? m?.scope?.from ?? '2016-01-01T00:00:00Z'),
    before: iso(before ?? m?.scope?.before ?? new Date().toISOString()),
    parentGate: 'public-undeleted-real-vehicle-v1', creationCutoff: 'created_at-before-selection-end' };
  if (Date.parse(scope.from) >= Date.parse(scope.before)) fail('Population close window must be nonempty.');
  if (m) {
    if (m.contract !== CONTRACT || m.method !== BID_METHOD || !same(m.scope, scope)
      || !Array.isArray(m.parents) || !Array.isArray(m.groups) || !Array.isArray(m.superseded)) fail('Capture scope, method or manifest changed. Use a new capture directory.');
    if (m.foldHash !== foldHash) {
      if (!refreshMethod) fail('Canonical fold source changed. Explicit --refresh-method remeasures retained inputs without changing their retrieval clocks.');
      m.methodHistory ??= [];
      m.methodHistory.push({ hash:m.foldHash, readCompletedAt:m.completedAt, revisedAt:new Date().toISOString() });
      m.foldHash = foldHash;
    }
  } else {
    // Never adopt a legacy sample or unreceipted files as a complete population.
    if ((await fs.readdir(cache)).some(name => name !== 'capture.lock' && !name.endsWith('.tmp'))) fail('Population cache is not empty and has no valid manifest.');
    m = { contract: CONTRACT, method: BID_METHOD, foldHash, scope, startedAt: new Date().toISOString(),
      completedAt: null, parents: [], parentsComplete: false, groups: [], superseded: [] };
  }
  m.parentPageSize = parentPageSize ?? m.parentPageSize ?? 500;
  if (!Number.isInteger(m.parentPageSize) || m.parentPageSize < 25 || m.parentPageSize > 500) fail('Invalid retained parent page budget.');
  const save = () => atomic(manifestFile, JSON.stringify(m, null, 2) + '\n');
  await save();
  let requests = 0;
  const allParents = [];
  const load = async (entry, after, kind, allowed) => {
    if (!/^page-[0-9a-f-]+\.json$/.test(entry.file) || entry.after !== after) fail('Retained page continuation changed.');
    const bytes = await fs.readFile(path.join(cache, entry.file));
    if (hash(bytes) !== entry.hash) fail('Retained population page hash changed.');
    const page = JSON.parse(bytes);
    if (page.after !== after || page.kind !== kind || page.readAt !== entry.readAt || page.rows.length !== entry.n) fail('Retained page receipt changed.');
    validateRows(page.rows, after, kind, scope, allowed);
    return page.rows;
  };
  const page = async (kind, after, ids) => {
    if (requests >= maxRequests) return null;
    requests++;
    const rows = await reader[kind]({ scope, after, ids, ...(kind === 'parents' ? { limit:m.parentPageSize } : {}) });
    validateRows(rows, after, kind, scope, new Set(ids));
    const readAt = new Date().toISOString(), file = `page-${randomUUID()}.json`;
    const bytes = JSON.stringify({ kind, after, readAt, rows });
    await atomic(path.join(cache, file), bytes);
    return { rows, entry: { file, hash: hash(bytes), after, readAt, n: rows.length } };
  };
  let parentAfter = null, parentEnd = false;
  for (const entry of m.parents) {
    if (parentEnd) fail('Retained parent pages continue after the terminal page.');
    const rows = await load(entry, parentAfter, 'parents');
    allParents.push(...rows);
    parentEnd = rows.length === 0;
    parentAfter = rows.at(-1)?.id ?? parentAfter;
  }
  if (m.parentsComplete !== parentEnd) fail('Parent completion requires a retained terminal empty page.');
  if (m.completedAt && (!m.parentsComplete || m.groups.some(g => !g.complete)
    || !same(m.groups.flatMap(g => g.ids), allParents.map(l => l.id)))) fail('Capture completion requires every enumerated parent and child batch to be complete.');
  const receipt = () => ({ contract: CONTRACT, complete: Boolean(m.completedAt), phase: m.completedAt ? 'complete' : m.parentsComplete ? 'bids' : 'parents',
    scope, startedAt: m.startedAt, completedAt: m.completedAt, requests,
    selectedEpisodes: allParents.length, selectedVehicles: new Set(allParents.map(l => l.vehicle_id)).size,
    parentsComplete: m.parentsComplete, completedGroups: m.groups.filter(g => g.complete).length, totalGroups: m.groups.length,
    supersededGroups: m.superseded.length, output: null });
  while (!m.parentsComplete) {
    let result;
    try { result = await page('parents', parentAfter); }
    catch (error) {
      if (error.code !== '57014' || m.parentPageSize === 25) throw error;
      m.parentPageSize = Math.max(25, Math.floor(m.parentPageSize / 2));
      await save();
      continue;
    }
    if (!result) return receipt();
    m.parents.push(result.entry);
    allParents.push(...result.rows);
    m.parentsComplete = result.rows.length === 0;
    parentAfter = result.rows.at(-1)?.id ?? parentAfter;
    await save();
    onProgress(receipt());
  }
  if (selectOnly) return { ...receipt(), complete: false, output: null };
  if (!m.groups.length && allParents.length) {
    for (let i = 0; i < allParents.length; i += 40) m.groups.push({ ids: allParents.slice(i, i + 40).map(l => l.id), pages: [], complete: false });
    await save();
  }
  if (!same(m.groups.flatMap(g => g.ids), allParents.map(l => l.id))) fail('Retained child groups do not cover exactly the enumerated parents.');
  if (m.completedAt && m.groups.some(g => !g.complete)) fail('Capture completion requires every child batch to be complete.');
  for (let i = 0; i < m.groups.length; i++) {
    const group = m.groups[i], allowed = new Set(group.ids);
    if (!Array.isArray(group.pages) || group.ids.length > 40 || !group.ids.length) fail('Invalid retained child batch.');
    let after = null, terminal = false;
    for (const entry of group.pages) {
      if (terminal) fail('Retained child pages continue after the terminal page.');
      const rows = await load(entry, after, 'bids', allowed);
      terminal = rows.length === 0;
      after = rows.at(-1)?.id ?? after;
    }
    if (group.complete !== terminal) fail('Child completion requires a retained terminal empty page.');
    while (!group.complete) {
      let result;
      try { result = await page('bids', after, group.ids); }
      catch (error) {
        if (error.code !== '57014' || group.ids.length === 1) throw error;
        // Separate expensive episodes without dropping evidence or returning to sampling.
        m.superseded.push({ ...group, reason: 'statement_timeout_split' });
        const middle = Math.ceil(group.ids.length / 2);
        m.groups.splice(i, 1, ...[group.ids.slice(0, middle), group.ids.slice(middle)].map(ids => ({ ids, pages: [], complete: false })));
        await save();
        i--;
        break;
      }
      if (!result) return receipt();
      group.pages.push(result.entry);
      group.complete = result.rows.length === 0;
      after = result.rows.at(-1)?.id ?? after;
      await save();
    }
    onProgress(receipt());
  }
  // Fold one bounded batch at a time; do not retain every raw bid row in memory.
  const byId = new Map(allParents.map(l => [l.id, l]));
  const readAt = new Date(Math.max(Date.parse(m.startedAt), ...m.parents.map(p => Date.parse(p.readAt)),
    ...m.groups.flatMap(g => g.pages.map(p => Date.parse(p.readAt))))).toISOString();
  if (m.completedAt && m.completedAt !== readAt) fail('Capture completion clock differs from retained page clocks.');
  const study = makeStudy([], [], readAt, '', false);
  let readBidRows = 0;
  for (const group of m.groups) {
    if (!group.complete) fail('Incomplete child batch cannot be published.');
    const bids = []; let after = null;
    for (const entry of group.pages) {
      const rows = await load(entry, after, 'bids', new Set(group.ids));
      bids.push(...rows); after = rows.at(-1)?.id ?? after;
    }
    readBidRows += bids.length;
    const part = makeStudy(group.ids.map(id => byId.get(id)), bids, study.readAt, '', false);
    study.candidateN += part.candidateN;
    study.lots.push(...part.lots); study.exclusions.push(...part.exclusions);
    for (const [year, count] of Object.entries(part.candidatesByYear)) study.candidatesByYear[year] = (study.candidatesByYear[year] ?? 0) + count;
  }
  study.selection = `Enumerated public sold BaT episodes with known close from ${scope.from} before ${scope.before}, recorded creation before ${scope.before}; UUID pages exhausted, all keyed positive bid pages read. This is the declared stored population, not all BaT or global sales.`;
  study.knowledgeMode += ` Sequential public capture ${m.startedAt} through ${study.readAt}; mutable parent fields are read-time values, not an atomic historical snapshot. Source capture freshness and wider market coverage remain unknown.`;
  const outputBytes = JSON.stringify(encodeStudy(study));
  const coverage = { ...receipt(), complete: true, phase: 'complete', completedAt: study.readAt, output,
    readBidRows, usableEpisodes: study.lots.length, excludedEpisodes: study.exclusions.length,
    exclusionReasons: study.exclusions.reduce((counts, e) => { counts[e.reason] = (counts[e.reason] ?? 0) + 1; return counts; }, {}),
    foldedAt: new Date().toISOString(), foldHash, methodHistory:m.methodHistory ?? [], sourceFreshness: 'unverified', marketDenominator: null,
    inputHash: hash(JSON.stringify({ scope, parents: m.parents, groups: m.groups })),
    outputHash: hash(outputBytes), outputBytes: Buffer.byteLength(outputBytes) };
  await atomic(output, outputBytes);
  await atomic(`${output}.receipt.json`, JSON.stringify(coverage, null, 2) + '\n');
  m.completedAt = study.readAt;
  await save();
  return coverage;
}
