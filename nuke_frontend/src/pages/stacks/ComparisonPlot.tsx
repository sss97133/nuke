import { Fragment, useState, type ReactNode } from 'react';
import { quantile, MIN_DISTRIBUTION, type MeasurementGroup, type MeasurementResult } from './bidMeasurements';

import { formatMeasure, usePlotWidth } from './stackFormat';

const makeLogos: Record<string, string> = {
  chevrolet: 'chevrolet.svg', porsche: 'porsche.jpg', toyota: 'toyota.svg',
  bmw: 'bmw.svg', ford: 'ford.svg', 'mercedes-benz': 'mercedes-benz.svg',
};
export function MakeLogo({ make }: { make: string }) {
  const file = makeLogos[make.toLowerCase()];
  return file ? <img className="sx-make-logo" src={`/stacks/makes/${file}`} alt="" width="24" height="24" /> : null;
}
export function PlotKey({ spread = 'Middle 50% of records', reference = true, average = 'Group average' }: { spread?: string; reference?: boolean; average?: string }) {
  return <div className="sx-chart-key"><span><i className="sx-key-dot" />{average}</span><span><i className="sx-key-range" />{spread}</span>{reference && <span><i className="sx-key-reference" />Selection median</span>}</div>;
}
function numericScale(values: number[], width: number, fixedPercent: boolean, allowLog: boolean) {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (lo === hi) { lo = Math.max(0, lo - 1); hi += 1; }
  const log = allowLog && !fixedPercent && lo > 0 && hi / lo > 50;
  const l = fixedPercent ? 0 : log ? Math.log10(lo) - .08 : Math.max(0, lo - (hi - lo) * .06);
  const h = fixedPercent ? 100 : log ? Math.log10(hi) + .08 : hi + (hi - lo) * .06;
  const x = (v: number) => 8 + ((log ? Math.log10(v) : v) - l) / (h - l) * (width - 16);
  const tickN = width < 220 ? 3 : 4;
  const ticks = Array.from({ length: tickN }, (_, i) => log ? 10 ** (l + (h - l) * i / (tickN - 1)) : l + (h - l) * i / (tickN - 1));
  return { x, ticks, log };
}

/** The same measured mark, observed spread and named reference at both browsing depths. */
export default function ComparisonPlot({ result, groups, scaleGroups = groups, selected, onSelect, compact = false, referenceName, inspection, referenceInspection }: {
  result: MeasurementResult; groups: MeasurementGroup[]; selected?: string | null;
  scaleGroups?: MeasurementGroup[];
  onSelect: (g: MeasurementGroup) => void; compact?: boolean; referenceName: string;
  inspection?: ReactNode; referenceInspection?: ReactNode;
}) {
  const [referenceOpen, setReferenceOpen] = useState(false);
  const { ref, width } = usePlotWidth(), metric = result.expression.measure;
  const auction = result.expression.grouping === 'auction', wins = metric === 'winRate';
  const referenceValues = result.rankValues, n = referenceValues.length, median = result.median;
  const q25 = quantile(referenceValues, .25), q75 = quantile(referenceValues, .75);
  const extents = [...scaleGroups.flatMap(g => wins ? [g.mean] : [g.mean, g.q25, g.q75]), ...(median === null ? [] : [median]), ...((auction || wins) && q25 !== null && q75 !== null ? [q25, q75] : [])];
  const allowLog = !['participants', 'bids'].includes(metric), fixedPercent = ['entry', 'winRate'].includes(metric);
  const { x, ticks, log } = numericScale(extents, width, fixedPercent, allowLog);
  const referenceScale = n ? numericScale(referenceValues, width, fixedPercent, allowLog) : null;
  const spread = wins ? 'Middle 50% of eligible peers' : auction ? 'Middle 50% of this selection' : 'Middle 50% within each group';
  return <div className={`sx-comparison${compact ? ' sx-comparison-compact' : ''}${auction ? ' sx-comparison-auction' : ''}`}>
    <PlotKey spread={spread} average={auction ? 'Auction reading' : wins ? 'Captured win rate' : 'Group average'} />
    {median !== null && <details className="sx-reference-inspector" onToggle={e => setReferenceOpen(e.currentTarget.open)}>
      <summary><i className="sx-key-reference" /><span>{referenceName} · median <b>{formatMeasure(metric, median)}</b></span><span className="sx-reference-open">Inspect ↓</span></summary>
      {referenceOpen && <div className="sx-reference-body">
        <p>{n.toLocaleString()} {result.rankGrain === 'participant' ? 'eligible participant averages' : 'auction records'} · equal reference weight · middle 50% {formatMeasure(metric, q25!)}–{formatMeasure(metric, q75!)}.</p>
        {referenceScale && <svg width="100%" viewBox={`0 0 ${width} 64`} role="img" aria-label={`Every reference reading, full ${referenceScale.log ? 'logarithmic' : 'linear'} scale`}>
          <rect x={referenceScale.x(q25!)} y="15" width={referenceScale.x(q75!) - referenceScale.x(q25!)} height="10" className="sx-iqr" />
          {referenceValues.map((v, i) => <circle key={i} cx={referenceScale.x(v)} cy={20 + (i % 3 - 1) * 4} r="1.8" className="sx-record" />)}
          <line x1={referenceScale.x(median)} x2={referenceScale.x(median)} y1="7" y2="36" className="sx-reference" />
          {referenceScale.ticks.map((t, i, a) => <text key={i} x={referenceScale.x(t)} y="57" textAnchor={i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle'}>{formatMeasure(metric, t, true)}</text>)}
        </svg>}
        {referenceInspection ?? <p>Each auction contributes one measurement. The median is the middle record; the dark dot is a group average. An average can sit beyond the middle 50% when a few records are unusually large.</p>}
      </div>}
    </details>}
    <div className="sx-comparison-axis sx-comparison-grid"><span>{auction ? 'One auction per row' : result.expression.grouping === 'participant' ? 'Captured record' : 'Market'}</span><div ref={ref}><svg width="100%" viewBox={`0 0 ${width} 30`} aria-label={`Shared ${log ? 'logarithmic' : 'linear'} measurement axis`} role="img">{ticks.map((t, i) => <text key={i} x={x(t)} y="21" textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{formatMeasure(metric, t, true)}</text>)}</svg></div><span>Reading{auction && <small>Percentile / {n} auctions</small>}</span>{!auction && <span>Auctions</span>}</div>
    {groups.map(g => <Fragment key={g.key}>
      <button type="button" className="sx-distribution-row sx-comparison-grid" aria-pressed={selected === g.key} onClick={() => onSelect(g)}
        aria-label={`Explore ${result.expression.grouping === 'participant' ? `${g.lotIds.length} auctions, ${g.label}` : g.label}, ${auction ? 'reading' : 'average'} ${formatMeasure(metric, g.mean)}, ${g.values.length} records`}>
        <span className="sx-row-label">{g.make && <MakeLogo make={g.make} />}<strong>{result.expression.grouping === 'participant' ? `${g.wins} / ${g.knownOutcomes} captured wins` : g.label}</strong></span>
        <svg width="100%" viewBox={`0 0 ${width} 44`} aria-hidden="true">
          {ticks.map((t, i) => <line key={i} x1={x(t)} x2={x(t)} y1="0" y2="44" className="sx-grid" />)}
          {(auction || wins ? n : g.values.length) >= MIN_DISTRIBUTION && <rect x={x(auction || wins ? q25! : g.q25)} y="17" width={Math.max(0, x(auction || wins ? q75! : g.q75) - x(auction || wins ? q25! : g.q25))} height="10" className="sx-iqr" />}
          {median !== null && <line x1={x(median)} x2={x(median)} y1="0" y2="44" className="sx-reference" />}
          <circle cx={x(g.mean)} cy="22" r="4" className="sx-time-point" />
          {selected === g.key && <circle cx={x(g.mean)} cy="22" r="8" className="sx-selected-ring" />}
        </svg>
        <span className="sx-row-value">{formatMeasure(metric, g.mean, compact)}{auction && <small title={`Empirical midrank among ${n} individual auction readings`}>{n >= MIN_DISTRIBUTION ? `P${Math.round(g.percentile)}` : 'Sparse selection'}</small>}</span>
        {!auction && <span className="sx-row-n">{g.lotIds.length.toLocaleString()}</span>}
      </button>
      {selected === g.key && inspection}
    </Fragment>)}
    <div className="sx-axis-direction"><span>{metric === 'spacing' ? '← Shorter gaps' : '← Smaller readings'}</span><span>{auction ? 'P = sample percentile · ' : ''}{log ? 'Log scale · ' : ''}{metric === 'spacing' ? 'Longer gaps →' : 'Larger readings →'}</span></div>
  </div>;
}
