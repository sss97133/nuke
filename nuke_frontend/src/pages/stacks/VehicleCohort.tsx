import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { useBidStudy, useStudyFacets, matchingFacetIds, profileFacetValue, type ProfileFacet } from './bidPopulationReader';
import { MIN_DISTRIBUTION, percentile, quantile, type BidMeasure } from './bidMeasurements';
import { useOrderBook, type OrderBookRead } from './orderBookReader';
import AnalyticalHeading from './AnalyticalHeading';
import { expressionFromParams, measures, stackBackParams } from './bidExpression';
import { cohortReadings } from './cohortMeasurements';
import { formatMeasure, usePlotWidth } from './stackFormat';
import './stackExplore.css';

const performanceMeasures = [
  { measure: 'participants' as const, label: 'Competition', unit: 'resolved bidder identities' },
  { measure: 'typical' as const, label: 'Bid steps', unit: '% median raise' },
  { measure: 'spacing' as const, label: 'Bid pace', unit: 'seconds median gap' },
];
const dayLabel = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Date unknown';

/** The profile and its configuration doors compose the same complete-sequence stack.
 * Facets describe current recorded labels, never inferred equipment at a past sale. */
export function VehiclePerformance({ vehicleId, facet }: { vehicleId: string; facet?: { dimension: ProfileFacet; value: string; label: string } }) {
  const [params, setParams] = useSearchParams();
  const orderBook = useOrderBook(vehicleId, params.get('performanceLot') ?? 'latest');
  const read = orderBook.data;
  const study = useBidStudy(Boolean(read?.lot));
  const [scope, setScope] = useState(facet ? 'vehicleYear' : 'model');
  const [sameYear, setSameYear] = useState(false);
  const configurations = useStudyFacets(study.data, read?.vehicle.make ?? null, Boolean(facet && read));
  const referenceIds = useMemo(() => facet && configurations.data
    ? matchingFacetIds(configurations.data, facet.dimension, facet.value) : undefined, [facet, configurations.data]);
  const year = read?.lot?.auction_end_date ? new Date(read.lot.auction_end_date).getUTCFullYear() : null;
  const period = sameYear && year && Number.isFinite(year) ? { from: year, to: year } : undefined;
  const analyses = study.data && read && (!facet || configurations.data) ? performanceMeasures.map(item => ({ ...item,
    analysis: cohortReadings(study.data!, read, scope, item.measure, period, referenceIds),
  })) : [];
  const measured = analyses.filter(({ analysis }) => analysis.reading !== null && analysis.result.rankValues.length >= MIN_DISTRIBUTION);
  if (orderBook.isError || study.isError || (facet && configurations.isError)) return <section className="vp-performance" aria-label="Auction performance"><p role="status">The performance stack could not be read. <button type="button" onClick={() => { void orderBook.refetch(); void study.refetch(); if (facet) void configurations.refetch(); }}>Retry</button></p></section>;
  if (orderBook.isPending) return <p role="status" className="vp-performance">Reading performance…</p>;
  if (!read?.lot) return facet ? <p>Auction performance unavailable.</p> : null;
  if (!study.data || (facet && !configurations.data)) return <p role="status" className="vp-performance">Reading performance…</p>;
  const lot = read.lot;
  const selected = analyses[0]?.analysis;
  const subject = selected?.subject;
  const effectiveScope = selected?.effectiveScope ?? scope;
  const modelLabel = subject?.model ?? read.vehicle.normalized_model ?? read.vehicle.model;
  const vehicleYear = selected?.vehicleYear ?? read.vehicle.year;
  const scopeLabel = effectiveScope === 'make' ? read.vehicle.make : modelLabel;
  const end = lot.auction_end_date ? Date.parse(lot.auction_end_date) : NaN;
  const olderSale = read.lots.find(l => l.id !== lot.id && l.outcome === 'sold' && l.auction_end_date && Date.parse(l.auction_end_date) < end && Number(l.winning_bid) > 0);
  const change = lot.outcome === 'sold' && Number(lot.winning_bid) > 0 && olderSale ? 100 * (Number(lot.winning_bid) / Number(olderSale.winning_bid) - 1) : null;
  const broad = facet ? cohortReadings(study.data, read, scope, 'bids', period) : null;
  const broadIds = new Set(broad?.result.groups.flatMap(group => group.members.map(member => member.vehicleId)) ?? []);
  const readableFacets = facet ? configurations.data!.filter(row => broadIds.has(row.id)) : [];
  const knownFacets = facet ? readableFacets.filter(row => profileFacetValue(row, facet.dimension)) : [];
  const matchingN = knownFacets.filter(row => referenceIds?.has(row.id)).length;
  const eligible = selected?.result.eligibleLots ?? 0;
  const back = new URLSearchParams({ stack: 'SA', by: 'auction', measure: 'typical',
    make: read.vehicle.make ?? '', from: String(selected?.expression.from ?? 2016),
    to: String(selected?.expression.to ?? new Date(study.data.readAt).getUTCFullYear()), excludeVehicle: vehicleId });
  if (selected?.expression.model) back.set('model', selected.expression.model);
  if (selected?.expression.vehicleYear) back.set('vehicleYear', String(selected.expression.vehicleYear));
  const inspect = `/stacks/order-book/${vehicleId}?${new URLSearchParams({ lot: lot.id, back: back.toString() })}`;
  return <section className={`vp-performance${facet ? ' vp-performance--facet' : ''}`} aria-label={facet ? `${facet.label} performance stack` : 'Vehicle performance stack'}>
    {!facet && <div className="vp-performance__head"><h2>Auction performance</h2><label>Episode <select aria-label="Performance auction episode" value={lot.id} onChange={event => { const next = new URLSearchParams(params); next.set('performanceLot', event.target.value); setParams(next, { replace: true }); }}>
      {read.lots.map(l => <option key={l.id} value={l.id}>{dayLabel(l.auction_end_date)} · {l.outcome ?? 'Unknown result'}{l.lot_number ? ` · lot ${l.lot_number}` : ''}</option>)}
    </select></label></div>}
    <div className="vp-performance__scope">
      <select aria-label="Performance comparison scope" value={effectiveScope} onChange={event => setScope(event.target.value)}>
        <option value="vehicleYear" disabled={!vehicleYear || !selected?.model}>{vehicleYear} {modelLabel}</option>
        <option value="model" disabled={!selected?.model}>{modelLabel} · all model years</option>
        <option value="make">{read.vehicle.make} · all models</option>
      </select><span>{facet ? 'Current-label match · BaT' : 'BaT sample'} · bid years {selected?.expression.from}–{selected?.expression.to}</span>
    </div>
    {!facet && change !== null && <p className="vp-performance__change"><strong>{change >= 0 ? '+' : ''}{change.toFixed(1)}%</strong> sale amount since {olderSale!.auction_end_date?.slice(0,4)}</p>}
    {measured.length > 0 ? <table className="vp-performance__table"><thead><tr><th>Measure</th><th>Standing</th><th>Percentile</th></tr></thead><tbody>{measured.map(({ measure, label, analysis }) => {
      const rawRank = percentile(analysis.result.rankValues, analysis.reading!)!;
      const rank = measure === 'spacing' ? 100 - rawRank : rawRank;
      const standing = rank >= 75 ? measure === 'participants' ? 'Many bidders' : measure === 'typical' ? 'Large steps' : 'Fast' : rank < 25 ? measure === 'participants' ? 'Few bidders' : measure === 'typical' ? 'Small steps' : 'Slow' : 'Typical';
      return <tr key={measure}><th scope="row">{label}</th><td>{standing}</td><td><strong>P{Math.round(rank)}</strong><small>{analysis.result.rankValues.length} auctions</small><div className="vp-performance__scale" aria-hidden="true"><span style={{ left: `${Math.min(98, Math.max(2, rank))}%` }} /></div></td></tr>;
    })}</tbody></table> : <p className="vp-performance__unranked">{selected?.admissionFailure ? 'Episode unranked' : 'Reference too small'} <span>· {eligible} auction{eligible === 1 ? '' : 's'}</span></p>}
    <p className="vp-performance__context">{lot.outcome === 'live' ? 'Recorded live' : Number.isFinite(end) && end <= Date.now() ? 'Historical auction' : 'Auction record'} · {dayLabel(lot.auction_end_date)} <span>· snapshot {dayLabel(study.data.readAt)}</span></p>
    <details className="vp-performance__reference"><summary>Evidence & method</summary>
      {facet && knownFacets.length > 0 && <p><strong>Exact recorded label share: {(100 * matchingN / knownFacets.length).toFixed(1)}% ({matchingN}/{knownFacets.length})</strong>. {effectiveScope === 'vehicleYear' ? `${vehicleYear} ` : ''}{scopeLabel} vehicles with known current labels in this captured study. This is label incidence, not measured configuration rarity or all vehicles in Nuke.</p>}
      {!measured.length && <p>{selected?.admissionFailure ?? `At least ${MIN_DISTRIBUTION} measured peer episodes are required. Choose a wider reference above.`}</p>}
      <label><input type="checkbox" checked={sameYear} onChange={event => setSameYear(event.target.checked)} /> Bid year of this auction’s close</label>
      <p>Each percentile ranks this episode against measured peer auctions. Every episode of this vehicle is excluded. Higher means more bidder identities, larger median raises, or shorter median gaps respectively; these are separate measures, not an overall vehicle grade.</p>
      <table className="vp-performance__evidence-table"><thead><tr><th>Measure</th><th>This episode</th><th>Peer median</th><th>Measured / eligible</th></tr></thead><tbody>{analyses.map(({measure,label,analysis})=><tr key={label}><th scope="row">{label}</th><td>{analysis.reading === null ? 'Unmeasured' : formatMeasure(measure,analysis.reading)}</td><td>{analysis.result.median === null ? 'Unmeasured' : formatMeasure(measure,analysis.result.median)}</td><td>{analysis.result.rankValues.length}/{analysis.result.eligibleLots}</td></tr>)}</tbody></table>
      {facet && <p>{matchingN} matching current labels / {knownFacets.length} known / {readableFacets.length} readable {scopeLabel} reference vehicles. Unknown labels are excluded. Recorded configuration share is not factory rarity, and current labels do not prove equipment or location at sale.</p>}
      {facet && configurations.dataUpdatedAt > 0 && <p>Current labels read {dayLabel(new Date(configurations.dataUpdatedAt).toISOString())}; source capture clocks are not supplied by this metadata reader.</p>}
      {change !== null && <p>Sale-amount change uses the two recorded sold episodes in nominal USD: {Number(olderSale?.winning_bid).toLocaleString()} to {Number(lot.winning_bid).toLocaleString()}. Fees, maintenance, modifications and inflation are not included; this is not an investment return.</p>}
      <p>{study.data.selection} Auction end: {dayLabel(lot.auction_end_date)}. Lot record updated: {dayLabel(lot.updated_at)} (a write clock, not proof of a fresh source capture).</p>
      {facet && <p>Factory production totals and configuration premiums are not established by this auction study.</p>}
      <Link to={inspect}>Open full auction stack →</Link>
      {facet && <small>Full stack compares the selected model/year scope without the attribute filter.</small>}
    </details>
  </section>;
}

export default function VehicleCohort({ read }: { read: OrderBookRead }) {
  const study = useBidStudy(), [params,setParams] = useSearchParams(), navigate = useNavigate(), {ref,width} = usePlotWidth();
  const back = params.get('back');
  const inherited = expressionFromParams(stackBackParams(back));
  const inheritedMeasure = inherited.measure === 'entry' || inherited.measure === 'winRate' ? 'typical' : inherited.measure;
  const metricParam = params.get('cohortMeasure'), measure: BidMeasure = metricParam === 'spacing' || metricParam === 'bids' || metricParam === 'typical' ? metricParam : inheritedMeasure;
  const from = inherited.from, to = inherited.to;
  const scope = params.get('cohort') ?? (back ? inherited.vehicleYear ? 'vehicleYear' : inherited.model ? 'model' : 'make' : 'model');
  const analysis = useMemo(() => study.data ? cohortReadings(study.data,read,scope,measure,{from,to}) : null,[study.data,read,scope,measure,from,to]);
  if (!study.data || !analysis) return <section className="sx-cohort" aria-label="Vehicle cohort"><h2>Vehicle cohort</h2><p role="status">{study.isError ? <>The captured study could not be read. <button type="button" onClick={() => void study.refetch()}>Try again</button></> : 'Reading the captured comparison population…'}</p></section>;
  const {result,expression,subject,reading,make,model,vehicleYear,effectiveScope} = analysis;
  if (!make) return null;
  const values = result.rankValues, n = values.length, median = result.median;
  const uniqueVehicles = new Set(result.groups.flatMap(g => g.members.map(m => m.vehicleId))).size;
  const makeN = study.data.lots.filter(l => l.make.toLowerCase() === make.toLowerCase()).length;
  const q25 = quantile(values,.25), q75 = quantile(values,.75);
  const extents = [...values,...(reading === null ? [] : [reading])], lo = Math.min(...extents), hi = Math.max(...extents);
  const log = lo > 0 && hi/lo > 50, low = log ? Math.log10(lo) : Math.min(0,lo), high = (log ? Math.log10(hi) : hi) || 1;
  const x = (v:number) => 16 + ((log ? Math.log10(v) : v)-low)/(high-low || 1)*(width-32);
  const ticks = Array.from({length:3},(_,i) => log ? 10 ** (low+(high-low)*i/2) : low+(high-low)*i/2);
  const position = reading === null || n < MIN_DISTRIBUTION ? null : percentile(values,reading);
  const lowerN = reading === null ? 0 : values.filter(value => value < reading).length;
  const peerPosition = lowerN === n ? `Higher than all ${n} sampled peers` : `Higher than ${lowerN} of ${n} sampled peers`;
  const query = (patch:Record<string,string|null> = {}) => {
    const p = new URLSearchParams({stack:'SA',by:'auction',measure,from:String(expression.from),to:String(expression.to),make,excludeVehicle:read.vehicle.id});
    if (expression.model) p.set('model',expression.model);
    if (expression.vehicleYear) p.set('vehicleYear',String(expression.vehicleYear));
    for (const [key,value] of Object.entries(patch)) {if(value === null) p.delete(key);else p.set(key,value);}
    return `/stacks?${p}`;
  };
  const change = (key:string,value:string) => {const next=new URLSearchParams(params);next.set(key,value);setParams(next);};
  return <section className="sx-cohort" aria-label="Vehicle cohort">
    <div className="sx-section-head"><h2>Vehicle cohort</h2><Link to={query()}>Explore cohort →</Link></div>
    {inherited.measure !== inheritedMeasure && <p>Participant entry/conversion does not rank auction records. This comparison uses record median raise size in the same study window.</p>}
    <div className="sx-cohort-membership" aria-label="Cohort membership">
      <button type="button" aria-pressed={effectiveScope === 'make'} onClick={() => change('cohort','make')}>{make}</button>
      {model && <><span>›</span><button type="button" aria-pressed={effectiveScope === 'model'} onClick={() => change('cohort','model')}>{model}</button></>}
      {model && vehicleYear !== null && <><span>›</span><button type="button" aria-pressed={effectiveScope === 'vehicleYear'} onClick={() => change('cohort','vehicleYear')}>{vehicleYear} model year</button></>}
      <small>{effectiveScope === 'make' ? 'All captured model labels' : subject?.modelBasis === 'source-label' ? 'Source model label' : 'Normalized model label'} · {effectiveScope === 'vehicleYear' ? 'same vehicle model year' : 'all vehicle model years'} · UTC bid years {expression.from}–{expression.to}</small>
    </div>
    <dl className="sx-cohort-population"><div><dt>Measured peer sample</dt><dd>{n.toLocaleString()} <small>auction records · {uniqueVehicles} vehicles</small></dd></div><div><dt>Captured make</dt><dd>{makeN.toLocaleString()} <small>{make} episodes in the study</small></dd></div><div><dt>Retained study</dt><dd>{study.data.lots.length.toLocaleString()} <small>episodes · {study.data.lots.reduce((sum,l) => sum+l.sums.bids,0).toLocaleString()} bids</small></dd></div></dl>
    <div className="sx-cohort-measures" aria-label="Cohort measurement"><button type="button" aria-pressed={measure === 'typical'} onClick={() => change('cohortMeasure','typical')}>Raise size</button><button type="button" aria-pressed={measure === 'spacing'} onClick={() => change('cohortMeasure','spacing')}>Bid spacing</button><button type="button" aria-pressed={measure === 'bids'} onClick={() => change('cohortMeasure','bids')}>Bid count</button></div>
    <AnalyticalHeading expression={expression} onChange={patch => navigate(query(patch))} />
    <div className="sx-cohort-reading"><strong>{reading === null ? 'Selected episode unranked' : formatMeasure(measure,reading)}</strong><span>{position === null ? n < MIN_DISTRIBUTION ? `Sparse reference · ${n} peer records` : 'Completed-episode reading unavailable' : `${peerPosition} · P${Math.round(position)}`}</span></div>
    {n > 0 && <figure className="sx-cohort-plot"><figcaption>Each dot = one peer auction · {measures[measure].unit}{log && ' · log scale'}</figcaption><div ref={ref}><svg width="100%" viewBox={`0 0 ${width} 104`} role="img" aria-label={`Selected auction against ${n} peer records; selection median ${median === null ? 'unavailable' : formatMeasure(measure,median)}`}>
      {ticks.map((t,i) => <g key={i}><line x1={x(t)} x2={x(t)} y1="10" y2="73" className="sx-grid"/><text x={x(t)} y="97" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{formatMeasure(measure,t,true)}</text></g>)}
      {n >= MIN_DISTRIBUTION && q25 !== null && q75 !== null && <rect x={x(q25)} y="40" width={x(q75)-x(q25)} height="12" className="sx-iqr" />}
      {values.map((value,i) => <circle key={i} cx={x(value)} cy={46+(i%5-2)*5} r="2.5" className="sx-record" />)}
      {median !== null && <line x1={x(median)} x2={x(median)} y1="23" y2="69" className="sx-reference" />}
      {reading !== null && <g><line x1={x(reading)} x2={x(reading)} y1="10" y2="73" className="sx-subject-line"/><path d={`M ${x(reading)} 9 l 6 6 l -6 6 l -6 -6 Z`} className="sx-time-point"/></g>}
    </svg></div><div className="sx-cohort-legend"><span>◆ Selected auction</span><span>Dashed line: peer median {median === null ? 'unavailable' : formatMeasure(measure,median)}</span>{n >= MIN_DISTRIBUTION && <span>Gray bar: middle 50% of peers</span>}</div></figure>}
    {!n && <p className="sx-chart-note">No eligible measured peers in this captured slice. Choose the model or make above to inspect a wider population.</p>}
    <details className="sx-cohort-coverage"><summary>Population, factory evidence & coverage</summary>
      <p>Reference: {make}{expression.model && ` / ${expression.model}`}{expression.vehicleYear && ` / ${expression.vehicleYear}`} · sold BaT episodes · UTC bid years {expression.from}–{expression.to}. This vehicle’s episodes are excluded from the reference. {result.eligibleLots} eligible peer episodes; {n} measured; {result.withheldRecordN} eligible records have no supported value for this measure. Model labels support browsing; generation, configuration and condition-matched valuation peers are not established.</p>
      <p>Study captured {new Date(study.data.readAt).toLocaleString()}: {study.data.lots.length} eligible / {study.data.candidateN} selected episodes; {study.data.exclusions.length} excluded. {study.data.selection} This reader does not measure Nuke’s entire holdings.</p>
      <dl><dt>Factory production</dt><dd>No source-qualified production denominator in this reader.</dd><dt>Global projection / margin of error</dt><dd>Withheld. This selected auction sample has no established probability sampling frame; its size alone cannot justify a global estimate.</dd></dl>
      <p>Captured auction episodes and distinct vehicles are separate units. Neither is a factory production count or a production-rarity claim. The spread is an observed distribution, not a confidence interval.</p>
      {analysis.admissionFailure && <p>Selected episode withheld by the existing complete-sequence gate: {analysis.admissionFailure}. Live partial sequences are not ranked against completed records.</p>}
      {subject && <p>Selected episode measurement: {subject.id === study.data.lots.find(l => l.id === subject.id)?.id ? 'retained study capture' : `current source sequence read ${new Date(read.readAt).toLocaleString()}`}. Method {result.method}.</p>}
      <Link to={query()}>Inspect contributing auction records →</Link>
    </details>
  </section>;
}
