import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { useBidStudy } from './bidPopulationReader';
import { MIN_DISTRIBUTION, percentile, quantile, type BidMeasure } from './bidMeasurements';
import type { OrderBookRead } from './orderBookReader';
import AnalyticalHeading from './AnalyticalHeading';
import { measures } from './bidExpression';
import { cohortReadings } from './cohortMeasurements';
import { formatMeasure, usePlotWidth } from './stackFormat';
import './stackExplore.css';

export default function VehicleCohort({ read }: { read: OrderBookRead }) {
  const study = useBidStudy(), [params,setParams] = useSearchParams(), navigate = useNavigate(), {ref,width} = usePlotWidth();
  const metricParam = params.get('cohortMeasure'), measure: BidMeasure = metricParam === 'spacing' || metricParam === 'bids' ? metricParam : 'typical';
  const analysis = useMemo(() => study.data ? cohortReadings(study.data,read,params.get('cohort') ?? 'model',measure) : null,[study.data,read,params,measure]);
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
    <div className="sx-cohort-membership" aria-label="Cohort membership">
      <button type="button" aria-pressed={effectiveScope === 'make'} onClick={() => change('cohort','make')}>{make}</button>
      {model && <><span>›</span><button type="button" aria-pressed={effectiveScope === 'model'} onClick={() => change('cohort','model')}>{model}</button></>}
      {model && vehicleYear !== null && <><span>›</span><button type="button" aria-pressed={effectiveScope === 'vehicleYear'} onClick={() => change('cohort','vehicleYear')}>{vehicleYear} model year</button></>}
      <small>{effectiveScope === 'make' ? 'All captured model labels' : subject?.modelBasis === 'source-label' ? 'Source model label' : 'Normalized model label'} · {effectiveScope === 'vehicleYear' ? 'same vehicle model year' : 'all vehicle model years'}</small>
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
