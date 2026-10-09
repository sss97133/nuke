import { evaluateBidExpression, sortedPercentile, quantile, type BidExpression, type MeasurementResult, type StudyDataset } from './bidMeasurements.ts';

/** Presentation pagination never limits the population passed to the canonical operator. */
export interface BidQueryCursor {
  snapshot: string; query: string; kind: 'groups' | 'contributors' | 'reference'; group: string | null; offset: number;
}
export interface BidQueryScope { paired?: boolean; excludeVehicle?: string | null }
export interface BidQueryPage { size?: number; cursor?: BidQueryCursor | null }

function validateExpression(e: BidExpression) {
  if (!['make','model','year','participant','auction'].includes(e.grouping)
    || !['amount','increment','relative','typical','spacing','participants','bids','entry','winRate'].includes(e.measure)
    || !Number.isInteger(e.from) || !Number.isInteger(e.to) || e.from < 2014 || e.to < e.from || e.to > 2200
    || !['auction','bid'].includes(e.weighting)
    || (e.weighting === 'bid' && !['amount','increment','relative'].includes(e.measure))
    || (['entry','winRate'].includes(e.measure) && e.grouping !== 'participant')
    || (e.measure === 'participants' && e.grouping === 'participant')
    || [e.make,e.model].some(v => v !== null && (typeof v !== 'string' || v.length > 500))
    || (e.vehicleYear != null && (!Number.isInteger(e.vehicleYear) || e.vehicleYear < 1886 || e.vehicleYear > 2202))) throw new Error('Unsupported analytical expression.');
}

/** One cached expression; avoid holding many copies of the full member population. */
export function createBidQuery(dataset: StudyDataset, snapshot: string) {
  if (!/^[0-9a-f]{64}$/.test(snapshot)) throw new Error('A verified study hash is required.');
  const byLot = new Map(dataset.lots.map(l => [l.id,l]));
  let cached: { key: string; result: MeasurementResult; sortedRecords:number[] | null } | null = null;
  const evaluate = (expression: BidExpression, scope: BidQueryScope) => {
    validateExpression(expression);
    if (scope.paired != null && typeof scope.paired !== 'boolean') throw new Error('Invalid paired scope.');
    if (scope.excludeVehicle != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.excludeVehicle)) throw new Error('Invalid excluded vehicle.');
    const excludedVehicle = scope.excludeVehicle?.toLowerCase() ?? null;
    const e: BidExpression = { measure:expression.measure, grouping:expression.grouping, from:expression.from, to:expression.to,
      make:expression.make, model:expression.model, vehicleYear:expression.vehicleYear ?? null, weighting:expression.weighting };
    const key = JSON.stringify({ expression:e, paired:scope.paired === true, excludeVehicle:excludedVehicle });
    if (cached?.key !== key) {
      cached = null;
      const selected = scope.paired || excludedVehicle ? { ...dataset, lots:dataset.lots.filter(l => l.vehicleId !== excludedVehicle
        && (!scope.paired || (l.winner && l.sums.gaps.some(gap => gap > 0)))) } : dataset;
      cached = { key, result:evaluateBidExpression(selected,e), sortedRecords:null };
    }
    return cached;
  };
  const page = (key: string, kind: BidQueryCursor['kind'], group: string | null, n: number, options: BidQueryPage) => {
    const size = options.size ?? 25, cursor = options.cursor;
    if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('Presentation page size must be 1–100.');
    if (cursor != null && (typeof cursor !== 'object' || Array.isArray(cursor))) throw new Error('Invalid analytical cursor.');
    if (cursor && (cursor.snapshot !== snapshot || cursor.query !== key || cursor.kind !== kind || cursor.group !== group
      || !Number.isInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > n)) throw new Error('Cursor does not match the study, expression or drill.');
    const offset = cursor?.offset ?? 0, end = Math.min(n,offset + size);
    return { offset, end, size, total:n, nextCursor:end < n ? { snapshot, query:key, kind, group, offset:end } : null };
  };
  return {
    groups(expression: BidExpression, options: BidQueryPage = {}, scope: BidQueryScope = {}) {
      const { key, result:r } = evaluate(expression,scope);
      const rows = expression.grouping === 'participant' ? r.groups.filter(g => g.lotIds.length >= (expression.measure === 'winRate' ? 5 : 2)) : r.groups;
      if (expression.measure === 'winRate') rows.sort((a,b) => b.mean - a.mean || b.lotIds.length - a.lotIds.length || a.label.localeCompare(b.label));
      const paging = page(key,'groups',null,rows.length,options);
      const extents = rows.flatMap(g => expression.measure === 'winRate' ? [g.mean] : [g.mean,g.q25,g.q75]);
      const referenceQ25 = quantile(r.rankValues,.25), referenceQ75 = quantile(r.rankValues,.75);
      if (r.median !== null) extents.push(r.median);
      if ((expression.grouping === 'auction' || expression.measure === 'winRate') && referenceQ25 !== null && referenceQ75 !== null) extents.push(referenceQ25,referenceQ75);
      const domain = extents.reduce((a,v) => ({ min:Math.min(a.min,v), max:Math.max(a.max,v) }),{ min:Infinity,max:-Infinity });
      return {
        contract:'bid-query-page-v1', snapshot, query:key, expression:r.expression, readAt:r.readAt, method:r.method,
        selection:r.selection, knowledgeMode:dataset.knowledgeMode,
        counts:{ studyCandidates:dataset.candidateN, studyUsable:dataset.lots.length, studyExcluded:dataset.exclusions.length,
          eligibleEpisodes:r.eligibleLots, contributingEpisodes:r.contributingLots, bids:r.bidN, raises:r.raiseN,
          withheldRecords:r.withheldRecordN, modelFallbackEpisodes:r.modelFallbackLots,
          allGroups:r.groups.length, presentedGroups:rows.length, referenceRecords:r.rankValues.length },
        reference:{ grain:r.rankGrain, records:r.rankValues.length, median:r.median, q25:referenceQ25, q75:referenceQ75 },
        domain:rows.length ? domain : null, page:paging,
        groups:rows.slice(paging.offset,paging.end).map(g => ({
          key:g.key,label:g.label,mean:g.mean,median:g.median,q25:g.q25,q75:g.q75,min:g.min,max:g.max,
          observations:g.observations,percentile:g.percentile,supported:g.supported,
          ...(g.make === undefined ? {} : {make:g.make}), ...(g.model === undefined ? {} : {model:g.model}),
          ...(g.year === undefined ? {} : {year:g.year}), ...(g.wins === undefined ? {} : {wins:g.wins}),
          ...(g.knownOutcomes === undefined ? {} : {knownOutcomes:g.knownOutcomes}), records:g.values.length, episodes:g.lotIds.length,
        })),
      };
    },
    references(expression: BidExpression, options: BidQueryPage = {}, scope: BidQueryScope = {}) {
      const { key,result:r } = evaluate(expression,scope);
      const paging = page(key,'reference',null,r.rankValues.length,options);
      const readings: Array<{ key:string; value:number; lotId?:string; vehicleId?:string; sourceUrl?:string }> = [];
      let index = 0;
      for (const group of r.groups) {
        if (r.rankGrain === 'participant') {
          if (group.lotIds.length < (expression.measure === 'winRate' ? 5 : 2)) continue;
          if (index >= paging.offset && index < paging.end) readings.push({key:group.key,value:group.mean});
          index++;
        } else {
          for (const m of group.members) {
            if (index >= paging.offset && index < paging.end) readings.push({key:m.id,value:m.value,lotId:m.lotId,vehicleId:m.vehicleId,sourceUrl:byLot.get(m.lotId)!.sourceUrl});
            index++;
          }
        }
        if (index >= paging.end) break;
      }
      return { contract:'bid-reference-page-v1', snapshot,query:key,expression:r.expression,readAt:r.readAt,method:r.method,
        grain:r.rankGrain, records:r.rankValues.length,median:r.median,page:paging,readings };
    },
    contributors(expression: BidExpression, group: string, options: BidQueryPage = {}, scope: BidQueryScope = {}) {
      const evaluated = evaluate(expression,scope), { key, result:r } = evaluated, selected = r.groups.find(g => g.key === group);
      if (!selected) throw new Error('The selected group is absent from this completed expression.');
      const members = [...selected.members].sort((a,b) => b.value - a.value);
      const paging = page(key,'contributors',group,members.length,options);
      // Full record reference, distinct from qualified participant-average ranks.
      const sortedRecords = evaluated.sortedRecords ??= [...r.values].sort((a,b) => a-b);
      return { contract:'bid-contributors-page-v1', snapshot, query:key, expression:r.expression, readAt:r.readAt, method:r.method,
        group:{ key:selected.key, label:selected.label, mean:selected.mean, percentile:selected.percentile, supported:selected.supported,
          episodes:selected.lotIds.length, records:selected.members.length },
        reference:{ groupGrain:r.rankGrain, groupReferenceN:r.rankValues.length, recordReferenceN:r.values.length },
        page:paging, contributors:members.slice(paging.offset,paging.end).map(m => {
          const lot = byLot.get(m.lotId)!;
          return { ...m, sourceUrl:lot.sourceUrl, end:lot.end, recordPercentile:sortedRecords.length ? sortedPercentile(sortedRecords,m.value) : null };
        }) };
    },
  };
}
