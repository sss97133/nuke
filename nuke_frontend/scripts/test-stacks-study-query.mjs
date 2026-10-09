import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { capturePopulation } from './stacks-population-capture.mjs';
import { loadPopulationQuery, analyzePopulation } from './stacks-study-query.mjs';
import { createBidQuery } from '../src/pages/stacks/bidQuery.ts';
import { decodeStudy, evaluateBidExpression, percentile } from '../src/pages/stacks/bidMeasurements.ts';

const uuid = (prefix,n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const expression = { measure:'relative', grouping:'make', from:2016, to:2026, make:null, model:null, vehicleYear:null, weighting:'auction' };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'nuke-query-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const parents = [], bids = [];
  for (let i = 1; i <= 150; i++) {
    const id = uuid('1',i), vehicle_id = uuid('3',i), source_url = `https://bringatrailer.com/listing/fixture-${i}/`;
    parents.push({ id, vehicle_id, source:'bat', source_url, created_at:'2026-09-01T00:00:00Z', auction_end_date:'2026-09-01T20:00:00Z',
      total_bids:2, winning_bid:i === 150 ? 999 : 100 + i, winning_bidder_external_identity_id:uuid('4',1),
      vehicles:{ id:vehicle_id, year:2000, make:'Chevrolet', model:'Corvette', normalized_model:'Corvette', is_public:true, deleted_at:null, listing_kind:null } });
    for (let j = 1; j <= 2; j++) bids.push({ id:uuid('2',(i-1)*2+j), auction_event_id:id, vehicle_id, source_url,
      posted_at:`2026-09-01T19:00:0${j}Z`, created_at:'2026-09-01T20:00:00Z', bid_amount:j === 1 ? 100 : 100 + i,
      external_identity_id:uuid('4',1), bat_comment_id:(i-1)*2+j, author_username:'fixture',
      vehicles:{ id:vehicle_id, is_public:true, deleted_at:null, listing_kind:null } });
  }
  const output = path.join(root,'study.json');
  await capturePopulation({ cache:path.join(root,'raw'), output, before:'2026-09-02T00:00:00Z', maxRequests:1000,
    reader:{ parents:async r => parents.filter(p => !r.after || p.id > r.after).slice(0,50),
      bids:async r => bids.filter(b => r.ids.includes(b.auction_event_id) && (!r.after || b.id > r.after)).slice(0,50) } });
  const dataset = decodeStudy(JSON.parse(await fs.readFile(output,'utf8')));
  return { output, dataset, query:await loadPopulationQuery(output) };
}

test('all149 usable episodes page exactly once; full statistics and reference survive page size changes', async t => {
  const { dataset,query } = await fixture(t), e = { ...expression,grouping:'auction' };
  const reference = evaluateBidExpression(dataset,e), small = query.groups(e,{size:7}), large = query.groups(e,{size:100});
  assert.deepEqual(small.counts,large.counts);
  assert.deepEqual(small.reference,large.reference);
  assert.deepEqual(small.domain,large.domain);
  assert.equal(small.reference.records,reference.rankValues.length);
  assert.equal(small.reference.median,reference.median);
  assert.equal(small.counts.studyCandidates,150);
  assert.equal(small.counts.studyExcluded,1);
  assert.equal(small.counts.contributingEpisodes,149);
  assert.equal(small.coverage.marketDenominator,null);
  const seen = []; let page = small;
  while (true) {
    seen.push(...page.groups);
    if (!page.page.nextCursor) break;
    page = query.groups(e,{size:7,cursor:page.page.nextCursor});
  }
  assert.deepEqual(seen.map(g => g.key),reference.groups.map(g => g.key));
  assert.equal(new Set(seen.map(g => g.key)).size,149);
  const readings = []; let refs = query.references(e,{size:13});
  while (true) { readings.push(...refs.readings); if (!refs.page.nextCursor) break; refs = query.references(e,{size:13,cursor:refs.page.nextCursor}); }
  assert.equal(readings.length,149);
  assert.equal(new Set(readings.map(r => r.key)).size,149);
  assert.deepEqual(readings.map(r => r.value).sort((a,b) => a-b),[...reference.rankValues].sort((a,b) => a-b));
  assert.ok(readings.every(r => r.sourceUrl && r.vehicleId && r.lotId));
  for (let i = 0; i < seen.length; i++) {
    const { members,lotIds,values,...expected } = reference.groups[i];
    assert.deepEqual(seen[i],{ ...expected,records:values.length,episodes:lotIds.length });
    assert.ok(!('members' in seen[i]));
  }
});

test('contributor pages preserve canonical identities, complete denominator, source links and empirical percentiles', async t => {
  const { dataset,query } = await fixture(t), e = { ...expression,grouping:'participant' };
  const r = evaluateBidExpression(dataset,e), group = r.groups[0];
  const all = []; let page = query.contributors(e,group.key,{size:31});
  while (true) { all.push(...page.contributors); if (!page.page.nextCursor) break; page = query.contributors(e,group.key,{size:31,cursor:page.page.nextCursor}); }
  assert.equal(page.page.total,149);
  assert.equal(page.group.mean,group.mean);
  assert.equal(page.group.percentile,group.percentile);
  assert.equal(page.reference.recordReferenceN,r.values.length);
  const refs = query.references(e);
  assert.equal(refs.records,r.rankValues.length);
  assert.deepEqual(refs.readings,[{key:group.key,value:group.mean}]);
  const expected = [...group.members].sort((a,b) => b.value-a.value);
  assert.deepEqual(all.map(m => m.id),expected.map(m => m.id));
  for (const m of all) {
    const lot = dataset.lots.find(l => l.id === m.lotId);
    assert.equal(m.vehicleId,lot.vehicleId);
    assert.equal(m.actorId,group.key);
    assert.equal(m.sourceUrl,lot.sourceUrl);
    assert.equal(m.recordPercentile,percentile(r.values,m.value));
  }
});

test('every supported grouping/measure and weighting preserves the canonical operator result', async t => {
  const {dataset,query} = await fixture(t);
  for (const grouping of ['make','model','year','participant','auction']) for (const measure of ['amount','increment','relative','typical','spacing','participants','bids','entry','winRate']) {
    if ((['entry','winRate'].includes(measure) && grouping !== 'participant') || (measure === 'participants' && grouping === 'participant')) continue;
    for (const weighting of ['auction',...(['amount','increment','relative'].includes(measure) ? ['bid'] : [])]) {
      const e = {...expression,grouping,measure,weighting}, r = evaluateBidExpression(dataset,e), page = query.groups(e,{size:100});
      assert.equal(page.counts.eligibleEpisodes,r.eligibleLots);
      assert.equal(page.counts.contributingEpisodes,r.contributingLots);
      assert.equal(page.counts.withheldRecords,r.withheldRecordN);
      assert.equal(page.reference.records,r.rankValues.length);
      assert.equal(page.reference.median,r.median);
      for (const group of page.groups) {
        const canonical = r.groups.find(g => g.key === group.key);
        for (const field of ['mean','median','q25','q75','min','max','percentile','supported','observations']) assert.equal(group[field],canonical[field]);
      }
    }
  }
});

test('cursors refuse a changed study, expression, scope or drill instead of silently continuing', async t => {
  const { dataset,query } = await fixture(t), e = { ...expression,grouping:'auction' };
  const cursor = query.groups(e,{size:1}).page.nextCursor;
  for (const options of [{snapshot:'0'.repeat(64)},{offset:-1},{offset:150},{kind:'contributors'},{group:'absent'}])
    assert.throws(() => query.groups(e,{cursor:{...cursor,...options}}),/Cursor/);
  assert.throws(() => query.groups({...e,measure:'amount'},{cursor}),/Cursor/);
  assert.throws(() => query.groups(e,{cursor},{paired:true}),/Cursor/);
  assert.throws(() => createBidQuery(dataset,'0'.repeat(64)).groups(e,{cursor}),/Cursor/);
  assert.throws(() => query.contributors(e,e.grouping,{cursor}),/absent/);
  for (const size of [0,101,1.5,NaN]) assert.throws(() => query.groups(e,{size}),/page size/);
  assert.throws(() => query.groups(e,{cursor:false}),/cursor/);
  assert.throws(() => query.groups(e,{}, {excludeVehicle:'------------------------------------'}),/vehicle/);
});

test('paired and vehicle exclusion use the exact canonical scoped population; unknown groups remain absent', async t => {
  const { dataset,query } = await fixture(t), scope = {paired:true,excludeVehicle:dataset.lots[0].vehicleId};
  const selected = {...dataset,lots:dataset.lots.filter(l => l.vehicleId !== scope.excludeVehicle && l.winner && l.sums.gaps.some(g => g > 0))};
  const expected = evaluateBidExpression(selected,expression), actual = query.groups(expression,{},scope);
  assert.equal(actual.counts.eligibleEpisodes,148);
  assert.equal(actual.counts.studyCandidates,150);
  assert.equal(actual.groups[0].mean,expected.groups[0].mean);
  const absent = query.groups({...expression,make:'no such make'});
  assert.equal(absent.groups.length,0);
  assert.equal(absent.reference.median,null);
  assert.equal(absent.domain,null);
});

test('partial, mutated and inconsistent population artifacts cannot be analyzed', async t => {
  const {output} = await fixture(t), receiptFile = `${output}.receipt.json`, receipt = JSON.parse(await fs.readFile(receiptFile,'utf8'));
  for (const fields of [{complete:false},{phase:'bids'},{selectedEpisodes:151},{completedAt:'2020-01-01T00:00:00Z'},{outputBytes:0},{outputHash:'0'.repeat(64)}]) {
    await fs.writeFile(receiptFile,JSON.stringify({...receipt,...fields}));
    await assert.rejects(loadPopulationQuery(output),/complete|disagree/);
  }
  await fs.writeFile(receiptFile,JSON.stringify(receipt));
  await fs.appendFile(output,' ');
  await assert.rejects(loadPopulationQuery(output),/hash-verified/);
});

test('operator mode stays offline and refuses capture/unknown options', async t => {
  const {output} = await fixture(t);
  const args = ['--analyze',`--input=${output}`,'--expression=by=auction&measure=relative','--size=3'];
  const direct = await analyzePopulation(args);
  const cli = spawnSync(process.execPath,['scripts/build-stacks-study.mjs',...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,VITE_SUPABASE_ANON_KEY:'sb_secret_'}});
  assert.equal(cli.status,0,cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout),direct);
  for (const extra of ['--population','--output=/tmp/no','--size=4','--expression=bogus=x'])
    await assert.rejects(analyzePopulation([...args,extra]),/Unknown|Duplicate/);
  await assert.rejects(analyzePopulation(['--analyze']),/explicit private/);
});

test('130837 synthetic records retain full group extrema and reference without argument-stack overflow', async t => {
  const {dataset} = await fixture(t), base = dataset.lots[0], n = 130837;
  const lots = Array.from({length:n},(_,i) => ({...base,id:uuid('1',i+1),vehicleId:uuid('3',i+1),
    sums:{...base.sums,relativeSum:i+1}, years:{2026:{...base.sums,relativeSum:i+1}}}));
  const large = {...dataset,lots,candidateN:n,exclusions:[]};
  const page = createBidQuery(large,'0'.repeat(64)).groups(expression,{size:1});
  assert.equal(page.counts.contributingEpisodes,n);
  assert.equal(page.reference.records,n);
  assert.equal(page.groups[0].mean,(n+1)/2);
  assert.equal(page.groups[0].min,1);
  assert.equal(page.groups[0].max,n);
  assert.equal(page.groups[0].records,n);
  assert.equal(page.reference.median,(n+1)/2);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 5000,'presentation response must not serialize the full reference vector');
});
