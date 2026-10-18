import { useState } from 'react';
import { quantile, type BidMeasure, type MeasurementGroup, type MeasurementResult } from './bidMeasurements';
import { PlotKey } from './ComparisonPlot';
import { formatMeasure as format, usePlotWidth } from './stackFormat';
const measureLabel = (m: BidMeasure) => ({typical:'Average auction median raise (%)',spacing:'Average auction median gap',relative:'Average relative raise (%)',amount:'Average bid (USD)',increment:'Average raise (USD)',participants:'Participants / auction',bids:'Bids / record',entry:'Average entry (%)',winRate:'Captured win conversion (%)'})[m];

export default function CalendarPlot({ result, onSelect, selected, compact = false }: { result: MeasurementResult; onSelect: (g: MeasurementGroup) => void; selected?: string | null; compact?: boolean }) {
  const { ref, width } = usePlotWidth(), [hover, setHover] = useState<MeasurementGroup | null>(null);
  const groups = result.groups, metric = result.expression.measure, h = compact ? 252 : 350, left = 54, right = width - 20, top = 30, bottom = h - 60;
  if (!groups.length) return null;
  const low = Math.min(0, ...groups.map(g => Math.min(g.q25, g.mean))), high = Math.max(...groups.map(g => Math.max(g.q75, g.mean))) * 1.12 || 1;
  const y = (v: number) => bottom - (v - low) / (high - low) * (bottom - top), x = (year: number) => result.expression.from === result.expression.to ? (left + right) / 2 : left + (year - result.expression.from + .15) / (Math.max(1, result.expression.to - result.expression.from) + .3) * (right - left);
  const currentYear = new Date(result.readAt).getUTCFullYear();
  const yearMap = new Map(groups.map(g => [g.year, g]));
  const segments: MeasurementGroup[][] = []; let segment: MeasurementGroup[] = [];
  for (let year = result.expression.from; year <= result.expression.to; year++) { const g = yearMap.get(year); if (g?.supported) segment.push(g); else { if (segment.length) segments.push(segment); segment = []; } } if (segment.length) segments.push(segment);
  const display = hover ?? groups.find(g => g.key === selected) ?? groups[groups.length - 1];
  return <div ref={ref} className="sx-calendar">
    <PlotKey average="Year average" spread="Middle 50% of auction-year records" reference={false} />
    {result.median !== null && <details className="sx-reference-inspector"><summary><i className="sx-key-reference" /><span>{result.values.length.toLocaleString()} auction-year records · median <b>{format(metric, result.median)}</b></span><span className="sx-reference-open">Inspect ↓</span></summary><div className="sx-reference-body">Each auction contributes one reading for every selected bid year in which it has observations. The dark line joins year averages; the dashed line is the median of all those records. Middle 50% of the selection: {format(metric, quantile(result.values,.25)!)}–{format(metric, quantile(result.values,.75)!)}. Select a year to inspect its contributors.</div></details>}
    <svg width="100%" viewBox={`0 0 ${width} ${h}`} role="img" aria-label={`${measureLabel(metric)} by bid calendar year, with auction-year distributions`}>
      <rect x={left} y={top} width={right - left} height={bottom - top} className="sx-frame" />
      {[0, 1, 2, 3, 4].map(i => { const v = low + (high - low) * i / 4; return <g key={i}><line x1={left} x2={right} y1={y(v)} y2={y(v)} className="sx-grid" /><text x={left - 9} y={y(v) + 4} textAnchor="end">{format(metric, v, true)}</text></g>; })}
      {result.median !== null && <line x1={left} x2={right} y1={y(result.median)} y2={y(result.median)} className="sx-reference" />}
      {segments.map((s, i) => <g key={i}><path d={s.map((g, j) => `${j ? 'L' : 'M'}${x(g.year!)},${y(g.mean)}`).join(' ')} className="sx-time-line" /></g>)}
      {groups.map(g => <g key={g.key}>{g.supported && <line x1={x(g.year!)} x2={x(g.year!)} y1={y(g.q25)} y2={y(g.q75)} className="sx-year-spread" />}<circle cx={x(g.year!)} cy={y(g.mean)} r={g.key === selected ? 6 : 4} className={g.supported && g.year !== currentYear ? 'sx-time-point' : 'sx-sparse-point'} /><circle cx={x(g.year!)} cy={y(g.mean)} r="18" fill="transparent" onPointerEnter={() => setHover(g)} onPointerLeave={() => setHover(null)} onClick={() => onSelect(g)} />{(width > 500 || g.year === result.expression.from || g.year === result.expression.to || g.year === Math.round((result.expression.from + result.expression.to) / 2)) && <text x={x(g.year!)} y={bottom + 24} textAnchor="middle">{g.year}{g.year === currentYear ? '*' : ''}</text>}</g>)}
      <text x={left} y="15">{measureLabel(metric)}</text><text x={(left + right) / 2} y={h - 12} textAnchor="middle">Bid event calendar year · UTC</text>
    </svg>
    <div className="sx-year-reading" aria-live="polite"><strong>{display.year}{display.year === currentYear ? ' · partial' : ''}</strong><b>{format(metric, display.mean)}</b><span>{display.values.length} auction-year records{display.supported ? '' : ' · sparse'}</span></div>
    <div className={`sx-year-buttons${compact ? ' sx-year-buttons-compact' : ''}`} aria-label="Inspect a year">{groups.map(g => <button type="button" key={g.key} aria-pressed={selected === g.key} onClick={() => onSelect(g)}>{g.year}<small>n {g.values.length}</small></button>)}</div>
    <span className="sx-preview-note">{groups.some(g => g.year === currentYear) && `* ${currentYear} is partial at capture · `}changing sampled mix · intervals show observed spread.</span>
  </div>;
}
