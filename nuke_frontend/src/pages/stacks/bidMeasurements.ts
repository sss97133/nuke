// Descriptive folds over complete, attributed auction sequences. These are research measurements,
// not historical knowledge snapshots or fitted bidder effects. The public source is nominal USD.
export const BID_METHOD = 'complete-sold-bid-sequence-v1';
export const MIN_DISTRIBUTION = 5;
export type BidMeasure = 'amount' | 'increment' | 'relative' | 'typical' | 'winRate' | 'entry' | 'spacing' | 'participants' | 'bids';
export type BidGrouping = 'make' | 'model' | 'year' | 'participant' | 'auction';
export interface BidVehicle { id: string; year: number | null; make: string | null; model: string | null; normalized_model: string | null }
export interface BidLot {
  id: string; vehicle_id: string; source: string; source_url: string; auction_end_date: string | null;
  total_bids: number | null; winning_bid: number | string | null;
  winning_bidder_external_identity_id: string | null; vehicles: BidVehicle;
}
export interface StudyBid {
  id: string; auction_event_id: string; vehicle_id: string; source_url: string | null;
  posted_at: string | null; created_at: string; bid_amount: number | string | null;
  external_identity_id: string | null; bat_comment_id: number | null; author_username: string | null;
}
export interface Sums {
  bids: number; bidSum: number; raises: number; raiseSum: number; relativeSum: number;
  gaps: number[]; relativeValues: number[]; identityIds: string[]; unresolvedBids: number;
}
export interface ActorReading extends Omit<Sums,'gaps' | 'relativeValues'> {
  identity: string; handle: string | null; entrySeconds: number; topBid: number; medianSpacing: number | null; medianRelative: number | null;
}
export interface LotReading {
  id: string; vehicleId: string; title: string; make: string; model: string; rawModel: string;
  modelBasis: 'normalized-label' | 'source-label'; vehicleYear: number | null;
  sourceUrl: string; end: string; hammer: number; winner: string | null; recordedWinner: string | null; winnerConflict: boolean;
  sums: Sums; years: Record<string, Sums>; actors: ActorReading[];
}
export interface StudyDataset {
  contract: 1; method: string; readAt: string; selection: string; knowledgeMode: string;
  candidateN: number; candidatesByYear: Record<string, number>; capped: boolean;
  exclusions: Array<{ id: string; year: number | null; reason: string }>;
  lots: LotReading[];
}
export interface BidExpression {
  measure: BidMeasure; grouping: BidGrouping; from: number; to: number;
  make: string | null; model: string | null; vehicleYear?: number | null; weighting: 'auction' | 'bid';
}
export interface MeasurementMember {
  id: string; lotId: string; vehicleId: string; title: string; value: number;
  observations: number; sum: number; actorId?: string; handle?: string | null;
}
export interface MeasurementGroup {
  key: string; label: string; make?: string; model?: string; year?: number;
  members: MeasurementMember[]; lotIds: string[]; values: number[];
  mean: number; median: number; q25: number; q75: number; min: number; max: number;
  observations: number; percentile: number; supported: boolean;
  wins?: number; knownOutcomes?: number;
}
export interface MeasurementResult {
  expression: BidExpression; method: string; readAt: string; selection: string;
  eligibleLots: number; contributingLots: number; bidN: number; raiseN: number;
  withheldRecordN: number; modelFallbackLots: number; groups: MeasurementGroup[];
  values: number[]; median: number | null; rankValues: number[]; rankGrain: 'record' | 'participant';
}

const stamp = (s: string | null) => s ? Date.parse(s) : NaN;
const trimmed = (s: string | null) => (s ?? '').replace(/\/+$/, '');
const number = (v: number | string | null) => v === null ? NaN : Number(v);
export const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
export function quantile(a: number[], p: number): number | null {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y), j = (b.length - 1) * p, i = Math.floor(j);
  return b[i] + (b[Math.min(i + 1, b.length - 1)] - b[i]) * (j - i);
}
export function percentile(a: number[], v: number): number | null {
  return a.length ? 100 * (a.filter(x => x < v).length + .5 * a.filter(x => x === v).length) / a.length : null;
}
function sortedPercentile(a: number[], v: number): number {
  const bound = (upper: boolean) => { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >>> 1;
    if (a[mid] < v || (upper && a[mid] === v)) lo = mid + 1; else hi = mid; } return lo; };
  const lower = bound(false), upper = bound(true); return 100 * (lower + .5 * (upper - lower)) / a.length;
}
export const emptySums = (): Sums => ({ bids: 0, bidSum: 0, raises: 0, raiseSum: 0, relativeSum: 0, gaps: [], relativeValues: [], identityIds: [], unresolvedBids: 0 });
export function mergeSums(a: Sums, b: Sums): Sums {
  return { bids: a.bids + b.bids, bidSum: a.bidSum + b.bidSum, raises: a.raises + b.raises,
    raiseSum: a.raiseSum + b.raiseSum, relativeSum: a.relativeSum + b.relativeSum,
    gaps: [...a.gaps, ...b.gaps], relativeValues: [...a.relativeValues, ...b.relativeValues], identityIds: [...new Set([...a.identityIds, ...b.identityIds])],
    unresolvedBids: a.unresolvedBids + b.unresolvedBids };
}
export function measured(s: Sums | ActorReading, measure: BidMeasure): { value: number; observations: number; sum: number } | null {
  if (measure === 'winRate' || measure === 'entry') return null;
  if (measure === 'amount') return s.bids ? { value: s.bidSum / s.bids, observations: s.bids, sum: s.bidSum } : null;
  if (measure === 'increment') return s.raises ? { value: s.raiseSum / s.raises, observations: s.raises, sum: s.raiseSum } : null;
  if (measure === 'relative') return s.raises ? { value: s.relativeSum / s.raises, observations: s.raises, sum: s.relativeSum } : null;
  if (measure === 'typical') { const v = 'relativeValues' in s ? quantile(s.relativeValues, .5) : s.medianRelative; return v === null ? null : { value:v, observations:1, sum:v }; }
  if (measure === 'spacing') { const v = 'gaps' in s ? quantile(s.gaps, .5) : s.medianSpacing; return v === null ? null : { value: v, observations: 1, sum: v }; }
  if (measure === 'participants') return s.unresolvedBids ? null : { value: s.identityIds.length, observations: 1, sum: s.identityIds.length };
  return { value: s.bids, observations: 1, sum: s.bids };
}
export function foldSoldLot(lot: BidLot, raw: StudyBid[]): { reading: LotReading | null; reason: string | null } {
  const failure = (reason: string) => ({ reading: null, reason });
  const end = stamp(lot.auction_end_date), hammer = number(lot.winning_bid);
  if (!['bat', 'bringatrailer'].includes(lot.source) || !/^https:\/\/bringatrailer\.com\/listing\/[^/?#]+\/?$/.test(lot.source_url)) return failure('unsupported source');
  if (!Number.isFinite(end) || !Number.isFinite(hammer) || !(hammer > 0)) return failure('missing close or recorded hammer');
  const rows = raw.filter(b => b.auction_event_id === lot.id && b.vehicle_id === lot.vehicle_id && trimmed(b.source_url) === trimmed(lot.source_url)
    && Number.isFinite(number(b.bid_amount)) && number(b.bid_amount) > 0 && Number.isFinite(stamp(b.posted_at)) && stamp(b.posted_at) >= end - 14 * 86400_000 && stamp(b.posted_at) <= end)
    .sort((a, b) => stamp(a.posted_at) - stamp(b.posted_at) || (a.bat_comment_id ?? Infinity) - (b.bat_comment_id ?? Infinity) || a.id.localeCompare(b.id));
  if (!rows.length) return failure('no matching keyed bid sequence');
  if (rows.length !== lot.total_bids) return failure('reported bid count mismatch');
  if (new Set(rows.map(r => r.id)).size !== rows.length) return failure('duplicate retained event');
  const sourceKeys = rows.map(r => r.bat_comment_id).filter(v => v !== null);
  if (new Set(sourceKeys).size !== sourceKeys.length) return failure('duplicate source event');
  if (number(rows[rows.length - 1].bid_amount) !== hammer) return failure('terminal bid does not reproduce hammer');
  for (let i = 1; i < rows.length; i++) {
    if (number(rows[i].bid_amount) <= number(rows[i - 1].bid_amount)) return failure('sequence conflict');
    if (stamp(rows[i].posted_at) === stamp(rows[i - 1].posted_at) && (rows[i].bat_comment_id === null || rows[i - 1].bat_comment_id === null)) return failure('unresolved source order');
  }
  const sums = emptySums(), years: Record<string, Sums> = {}, actors = new Map<string, Sums & Omit<ActorReading,'medianSpacing' | 'medianRelative'>>();
  const first = stamp(rows[0].posted_at);
  const add = (s: Sums, b: StudyBid, i: number) => {
    s.bids++; s.bidSum += number(b.bid_amount);
    if (b.external_identity_id) { if (!s.identityIds.includes(b.external_identity_id)) s.identityIds.push(b.external_identity_id); }
    else s.unresolvedBids++;
    if (i) { const previous = rows[i - 1], delta = number(b.bid_amount) - number(previous.bid_amount);
      s.raises++; s.raiseSum += delta; s.relativeSum += 100 * delta / number(previous.bid_amount); s.relativeValues.push(100 * delta / number(previous.bid_amount));
      s.gaps.push((stamp(b.posted_at) - stamp(previous.posted_at)) / 1000); }
  };
  rows.forEach((b, i) => {
    add(sums, b, i); const y = String(new Date(stamp(b.posted_at)).getUTCFullYear());
    years[y] ??= emptySums(); add(years[y], b, i);
    if (b.external_identity_id) {
      let actor = actors.get(b.external_identity_id);
      if (!actor) { actor = { ...emptySums(), identity: b.external_identity_id, handle: b.author_username,
        entrySeconds: (stamp(b.posted_at) - first) / 1000, topBid: number(b.bid_amount) }; actors.set(b.external_identity_id, actor); }
      add(actor, b, i); actor.topBid = number(b.bid_amount);
    }
  });
  const v = lot.vehicles, make = v.make?.trim() || 'Unknown make', rawModel = v.model?.trim() || 'Unknown model';
  return { reading: { id: lot.id, vehicleId: lot.vehicle_id, title: [v.year, make, rawModel].filter(Boolean).join(' '),
    make, model: v.normalized_model?.trim() || rawModel, rawModel, modelBasis: v.normalized_model ? 'normalized-label' : 'source-label',
    vehicleYear: v.year, sourceUrl: lot.source_url, end: lot.auction_end_date!, hammer,
    winner: lot.winning_bidder_external_identity_id && lot.winning_bidder_external_identity_id === rows[rows.length - 1].external_identity_id ? lot.winning_bidder_external_identity_id : null,
    recordedWinner: lot.winning_bidder_external_identity_id, winnerConflict: Boolean(lot.winning_bidder_external_identity_id && rows[rows.length - 1].external_identity_id && lot.winning_bidder_external_identity_id !== rows[rows.length - 1].external_identity_id), sums, years, actors: [...actors.values()].map(({gaps,relativeValues,...a}) => ({...a,medianSpacing:quantile(gaps,.5),medianRelative:quantile(relativeValues,.5)})) }, reason: null };
}
export function makeStudy(lots: BidLot[], bids: StudyBid[], readAt: string, selection: string, capped: boolean): StudyDataset {
  const byLot = new Map<string, StudyBid[]>();
  for (const b of bids) { const group = byLot.get(b.auction_event_id) ?? []; group.push(b); byLot.set(b.auction_event_id, group); }
  const unique = [...new Map(lots.map(l => [l.id, l])).values()], readings: LotReading[] = [], exclusions: StudyDataset['exclusions'] = [], candidatesByYear: Record<string, number> = {};
  for (const l of unique) {
    const t = stamp(l.auction_end_date), year = Number.isFinite(t) ? new Date(t).getUTCFullYear() : null;
    if (year !== null) candidatesByYear[year] = (candidatesByYear[year] ?? 0) + 1;
    const result = foldSoldLot(l, byLot.get(l.id) ?? []);
    if (result.reading) readings.push(result.reading); else exclusions.push({ id: l.id, year, reason: result.reason! });
  }
  return { contract: 1, method: BID_METHOD, readAt, selection, knowledgeMode: 'Source-order reconstruction from evidence held at read time; historical ingest availability unverified.',
    candidateN: unique.length, candidatesByYear, capped, exclusions, lots: readings };
}
function scopeSums(lot: LotReading, from: number, to: number) {
  return Object.entries(lot.years).filter(([year]) => Number(year) >= from && Number(year) <= to).reduce((a, [, b]) => mergeSums(a, b), emptySums());
}
export function evaluateBidExpression(dataset: StudyDataset, expression: BidExpression): MeasurementResult {
  const { measure, grouping, from, to, make, model, vehicleYear, weighting } = expression;
  const scoped = dataset.lots.filter(l => (!make || l.make.toLowerCase() === make.toLowerCase()) && (!model || l.model === model) && (!vehicleYear || l.vehicleYear === vehicleYear));
  const lotById = new Map(scoped.map(l => [l.id, l]));
  const buckets = new Map<string, { label: string; make?: string; model?: string; year?: number; members: MeasurementMember[] }>();
  let bidN = 0, raiseN = 0, missing = 0, modelFallbackLots = 0; const contributing = new Set<string>();
  const append = (key: string, label: string, m: MeasurementMember, extra: { make?: string; model?: string; year?: number } = {}) => {
    const bucket = buckets.get(key) ?? { label, members: [], ...extra }; bucket.members.push(m); buckets.set(key, bucket); contributing.add(m.lotId);
  };
  for (const l of scoped) {
    const s = scopeSums(l, from, to); if (!s.bids) continue;
    bidN += s.bids; raiseN += s.raises; if (l.modelBasis === 'source-label') modelFallbackLots++;
    if (grouping === 'year') {
      for (let year = from; year <= to; year++) { const ys = l.years[String(year)]; if (!ys) continue; const m = measured(ys, measure);
        if (m) append(String(year), String(year), { id: `${l.id}:${year}`, lotId: l.id, vehicleId: l.vehicleId, title: l.title, ...m }, { year }); else missing++; }
    } else if (grouping === 'participant') {
      // Participant records currently refer to complete episodes. Withhold crossing-year episodes rather
      // than silently including an actor's later bids in a narrower bid-year selection.
      if (Object.keys(l.years).some(y => Number(y) < from || Number(y) > to)) { missing += l.actors.length; continue; }
      const spanSeconds = l.sums.gaps.reduce((sum,gap) => sum + gap,0);
      for (const a of l.actors) { const m = measure === 'entry' ? (spanSeconds > 0 ? {value:100 * a.entrySeconds / spanSeconds,observations:1,sum:100 * a.entrySeconds / spanSeconds} : null) : measure === 'winRate' ? (l.winner ? {value:l.winner === a.identity ? 100 : 0,observations:1,sum:l.winner === a.identity ? 100 : 0} : null) : measured(a, measure); if (m) append(a.identity, a.handle || 'Unresolved handle',
        { id: `${l.id}:${a.identity}`, lotId: l.id, vehicleId: l.vehicleId, title: l.title, actorId: a.identity, handle: a.handle, ...m }); else missing++; }
    } else {
      const m = measured(s, measure); if (!m) { missing++; continue; }
      const key = grouping === 'make' ? l.make.toLowerCase() : grouping === 'model' ? `${l.make.toLowerCase()}\u0000${l.model}` : l.id;
      const label = grouping === 'make' ? l.make : grouping === 'model' ? l.model : l.title;
      append(key, label, { id: l.id, lotId: l.id, vehicleId: l.vehicleId, title: l.title, ...m }, { make: l.make, model: l.model });
    }
  }
  const values = [...buckets.values()].flatMap(b => b.members.map(m => m.value));
  const sortedValues = [...values].sort((a, b) => a - b);
  const groups = [...buckets].map(([key, b]): MeasurementGroup => {
    const v = b.members.map(m => m.value), observations = b.members.reduce((s, m) => s + m.observations, 0);
    const avg = weighting === 'bid' && ['amount', 'increment', 'relative'].includes(measure)
      ? b.members.reduce((s, m) => s + m.sum, 0) / observations : mean(v)!;
    const lotIds = [...new Set(b.members.map(m => m.lotId))];
    const outcomes = grouping === 'participant' ? lotIds.map(id => lotById.get(id)!).filter(l => l.winner) : [];
    return { key, ...b, lotIds, values: v, mean: avg,
      median: quantile(v, .5)!, q25: quantile(v, .25)!, q75: quantile(v, .75)!, min: v.reduce((a,b) => Math.min(a,b),Infinity), max: v.reduce((a,b) => Math.max(a,b),-Infinity), observations,
      percentile: sortedPercentile(sortedValues, avg), supported: v.length >= MIN_DISTRIBUTION,
      ...(grouping === 'participant' ? { knownOutcomes: outcomes.length, wins: outcomes.filter(l => l.winner === key).length } : {}) };
  });
  const rankValues = grouping === 'participant' ? groups.filter(g => g.lotIds.length >= (measure === 'winRate' ? 5 : 2)).map(g => g.mean) : values;
  if (grouping === 'participant') {
    const sortedRanks = [...rankValues].sort((a, b) => a - b);
    for (const g of groups) { g.percentile = sortedRanks.length ? sortedPercentile(sortedRanks,g.mean) : 0; g.supported = rankValues.length >= MIN_DISTRIBUTION && g.lotIds.length >= (measure === 'winRate' ? 5 : 2); }
  }
  groups.sort(grouping === 'year' ? (a, b) => (a.year ?? 0) - (b.year ?? 0) : (a, b) => b.lotIds.length - a.lotIds.length || a.label.localeCompare(b.label));
  return { expression, method: dataset.method, readAt: dataset.readAt, selection: dataset.selection,
    eligibleLots: scoped.filter(l => scopeSums(l, from, to).bids > 0).length, contributingLots: contributing.size,
    bidN, raiseN, withheldRecordN: missing, modelFallbackLots, groups, values, median: quantile(rankValues, .5), rankValues, rankGrain: grouping === 'participant' ? 'participant' : 'record' };
}

// Reuse the canonical midrank lookup when a reader keeps a sorted reference.
export { sortedPercentile };

// A transfer encoding, not a second identity model. Canonical keys survive the round trip;
// single-calendar-year lots share their full sums instead of sending those sums twice.
export function encodeStudy(data: StudyDataset) {
  const ids = [...new Set(data.lots.flatMap(l => [...l.sums.identityIds, ...l.actors.map(a => a.identity), ...(l.winner ? [l.winner] : []), ...(l.recordedWinner ? [l.recordedWinner] : [])]))];
  const index = new Map(ids.map((id, i) => [id, i]));
  const sums = (s: Sums) => [s.bids, s.bidSum, s.raises, s.raiseSum, s.relativeSum, s.gaps, s.identityIds.map(id => index.get(id)), s.unresolvedBids, s.relativeValues];
  return { ...data, lots: undefined, encoding: 'bid-study-tuples-v1', identities: ids, records: data.lots.map(l => {
    const years = Object.entries(l.years);
    return [l.id, l.vehicleId, l.title, l.make, l.model, l.rawModel, l.modelBasis === 'normalized-label' ? 1 : 0,
      l.vehicleYear, l.sourceUrl.replace('https://bringatrailer.com/listing/', ''), l.end, l.hammer,
      l.winner ? index.get(l.winner) : null, sums(l.sums), years.length === 1 ? Number(years[0][0]) : years.map(([y, s]) => [Number(y), sums(s)]),
      l.actors.map(a => [index.get(a.identity), a.handle, a.entrySeconds, a.topBid, [a.bids,a.bidSum,a.raises,a.raiseSum,a.relativeSum,a.unresolvedBids,a.medianSpacing,a.medianRelative]]), l.recordedWinner ? index.get(l.recordedWinner) : null, l.winnerConflict ? 1 : 0];
  }) };
}
export function decodeStudy(value: unknown): StudyDataset {
  const data = value as ReturnType<typeof encodeStudy>;
  const invalid = () => { throw new Error('Invalid retained study encoding.'); };
  if (!data || data.contract !== 1 || data.encoding !== 'bid-study-tuples-v1' || !Array.isArray(data.identities) || !Array.isArray(data.records)
    || data.method !== BID_METHOD || !Number.isFinite(Date.parse(data.readAt)) || !Array.isArray(data.exclusions) || typeof data.selection !== 'string' || typeof data.knowledgeMode !== 'string'
    || !Number.isInteger(data.candidateN) || data.candidateN < 0 || !data.candidatesByYear || typeof data.candidatesByYear !== 'object') invalid();
  const ids = data.identities;
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) invalid();
  const indexValid = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) < ids.length;
  const sums = (raw: unknown[]): Sums => {
    if (!Array.isArray(raw) || raw.length !== 9 || [0,1,2,3,4,7].some(i => typeof raw[i] !== 'number' || !Number.isFinite(raw[i]) || Number(raw[i]) < 0)
      || !Array.isArray(raw[5]) || !Array.isArray(raw[6]) || !Array.isArray(raw[8])
      || [...raw[5],...raw[8]].some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)
      || raw[5].length !== raw[2] || raw[8].length !== raw[2] || raw[6].some(v => !indexValid(v))) invalid();
    return { bids: raw[0] as number, bidSum: raw[1] as number, raises: raw[2] as number,
    raiseSum: raw[3] as number, relativeSum: raw[4] as number, gaps: raw[5] as number[], identityIds: (raw[6] as number[]).map(i => ids[i]), unresolvedBids: raw[7] as number, relativeValues: raw[8] as number[] };
  };
  const lots = data.records.map((row): LotReading => {
    if (!Array.isArray(row) || row.length !== 17 || [0,1,2,3,4,5,8,9].some(i => typeof row[i] !== 'string')
      || !Array.isArray(row[14]) || (row[11] !== null && !indexValid(row[11])) || (row[15] !== null && !indexValid(row[15]))) invalid();
    const full = sums(row[12] as unknown[]), yearRows = row[13];
    const years = typeof yearRows === 'number' ? { [yearRows]: full } : Object.fromEntries((yearRows as Array<[number, unknown[]]>).map(([y, s]) => [y, sums(s)]));
    return { id: row[0] as string, vehicleId: row[1] as string, title: row[2] as string, make: row[3] as string,
      model: row[4] as string, rawModel: row[5] as string, modelBasis: row[6] ? 'normalized-label' : 'source-label', vehicleYear: row[7] as number | null,
      sourceUrl: 'https://bringatrailer.com/listing/' + row[8], end: row[9] as string, hammer: row[10] as number,
      winner: row[11] === null ? null : ids[row[11] as number], recordedWinner: row[15] === null ? null : ids[row[15] as number], winnerConflict: row[16] === 1, sums: full, years,
      actors: (row[14] as unknown[][]).map(a => {
        const raw = a[4] as number[];
        if (!Array.isArray(a) || a.length !== 5 || !indexValid(a[0]) || !Array.isArray(raw) || raw.length !== 8
          || raw.slice(0,6).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)
          || raw.slice(6).some(v => v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))) invalid();
        return {bids:raw[0],bidSum:raw[1],raises:raw[2],raiseSum:raw[3],relativeSum:raw[4],unresolvedBids:raw[5],
          medianSpacing:raw[6],medianRelative:raw[7],identityIds:[ids[a[0] as number]],identity:ids[a[0] as number],
          handle:a[1] as string | null,entrySeconds:a[2] as number,topBid:a[3] as number};
      }) };
  });
  return { contract: 1, method: data.method, readAt: data.readAt, selection: data.selection, knowledgeMode: data.knowledgeMode,
    candidateN: data.candidateN, candidatesByYear: data.candidatesByYear, capped: data.capped, exclusions: data.exclusions, lots };
}

export interface ParticipantMapPoint { identity:string; n:number; entryPct:number; winRate:number; lotIds:string[] }
/** Paired records only: both axes have the same participant-auction denominator. */
export function participantBehaviorMap(dataset:StudyDataset, expression:BidExpression): ParticipantMapPoint[] {
  const entries = evaluateBidExpression(dataset,{...expression,grouping:'participant',measure:'entry',weighting:'auction'});
  const wins = evaluateBidExpression(dataset,{...expression,grouping:'participant',measure:'winRate',weighting:'auction'});
  const byIdentity = new Map(entries.groups.map(g => [g.key,new Map(g.members.map(m => [m.lotId,m.value]))]));
  return wins.groups.flatMap(g => {
    const times = byIdentity.get(g.key);
    const pairs = g.members.filter(m => times?.has(m.lotId));
    if (pairs.length < 5) return [];
    return [{identity:g.key,n:pairs.length,entryPct:mean(pairs.map(m => times!.get(m.lotId)!))!,
      winRate:mean(pairs.map(m => m.value))!,lotIds:pairs.map(m => m.lotId)}];
  });
}
