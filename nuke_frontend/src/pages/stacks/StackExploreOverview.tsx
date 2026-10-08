import { useMemo } from 'react';
import { evaluateBidExpression, participantBehaviorMap, type ParticipantMapPoint, type BidExpression, type MeasurementGroup, type StudyDataset } from './bidMeasurements';

const percent = (v: number) => `${v.toFixed(1)}%`;
const duration = (v: number) => v < 60 ? `${Math.round(v)}s` : v < 3600 ? `${Math.round(v / 60)}m` : `${(v / 3600).toFixed(1)}h`;
const base: BidExpression = { measure: 'typical', grouping: 'make', from: 2016, to: new Date().getUTCFullYear(), make: null, model: null, weighting: 'auction' };

function MiniDistribution({ groups, spacing = false }: { groups: MeasurementGroup[]; spacing?: boolean }) {
  const shown = groups.slice(0, 6), left = 108, right = 460;
  const lo = Math.max(.01, Math.min(...shown.map(g => g.q25))), hi = Math.max(...shown.map(g => Math.max(g.q75, g.mean)));
  const x = (v: number) => left + (Math.log(Math.max(lo, v)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1) * (right - left);
  return <svg viewBox="0 0 480 208" role="img" aria-label={spacing ? 'Observed bid spacing by make, logarithmic seconds axis' : 'Typical relative raises by make, logarithmic percent axis'}>
    {[0, .5, 1].map((p, i) => { const v = Math.exp(Math.log(lo) + p * (Math.log(hi) - Math.log(lo))); return <g key={i}><line x1={x(v)} x2={x(v)} y1="12" y2="181" className="sx-grid" /><text x={x(v)} y="202" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{spacing ? duration(v) : percent(v)}</text></g>; })}
    {shown.map((g, i) => { const y = 24 + i * 29; return <g key={g.key}><text x="0" y={y + 4}>{g.label}</text><line x1={x(g.q25)} x2={x(g.q75)} y1={y} y2={y} className="sx-overview-spread" /><circle cx={x(g.mean)} cy={y} r="3" className="sx-time-point" /></g>; })}
  </svg>;
}
function MiniCalendar({ groups }: { groups: MeasurementGroup[] }) {
  const left = 46, right = 460, top = 15, bottom = 178;
  const hi = Math.max(...groups.map(g => Math.max(g.mean, g.q75))) * 1.15 || 1;
  const x = (g: MeasurementGroup) => left + (g.year! - base.from) / (base.to - base.from) * (right - left), y = (v: number) => bottom - v / hi * (bottom - top);
  const segments: MeasurementGroup[][] = [];
  for (const g of groups) {
    if (!g.supported) continue;
    const last = segments[segments.length - 1];
    if (last?.[last.length - 1].year === g.year! - 1) last.push(g);
    else segments.push([g]);
  }
  return <svg viewBox="0 0 480 208" role="img" aria-label="Typical relative raises by bid calendar year, with observed auction-year spread">
    {[0, .5, 1].map((p, i) => <g key={i}><line x1={left} x2={right} y1={y(p * hi)} y2={y(p * hi)} className="sx-grid" /><text x={left - 7} y={y(p * hi) + 4} textAnchor="end">{percent(p * hi)}</text></g>)}
    {segments.map((s, i) => <path key={i} d={s.map((g, j) => `${j ? 'L' : 'M'}${x(g)},${y(g.q25)}`).join(' ') + s.slice().reverse().map(g => `L${x(g)},${y(g.q75)}`).join(' ') + 'Z'} className="sx-iqr" />)}
    {groups.map((g, i) => <g key={g.key}>{g.supported && groups[i - 1]?.supported && groups[i - 1].year === g.year! - 1 && <line x1={x(groups[i - 1])} x2={x(g)} y1={y(groups[i - 1].mean)} y2={y(g.mean)} className="sx-time-line" />}<circle cx={x(g)} cy={y(g.mean)} r="3" className={g.supported ? 'sx-time-point' : 'sx-sparse-point'} /></g>)}
    {[base.from, Math.round((base.from + base.to) / 2), base.to].map(year => <text x={left + (year - base.from) / (base.to - base.from) * (right - left)} y="202" textAnchor="middle" key={year}>{year}</text>)}
  </svg>;
}
function MiniParticipants({points}:{points:ParticipantMapPoint[]}) {
  const left=46,right=460,top=15,bottom=174;
  const maxRate=Math.max(25,Math.ceil(Math.max(0,...points.map(p => p.winRate)) / 25) * 25);
  const x=(v:number) => left + v / 100 * (right-left), y=(v:number) => bottom-v/maxRate*(bottom-top);
  return <svg viewBox="0 0 480 228" role="img" aria-label="Participant behavior map: average entry timing versus captured win conversion, paired attributed outcomes only">
    {[0,maxRate/2,maxRate].map((v,i) => <g key={i}><line x1={left} x2={right} y1={y(v)} y2={y(v)} className="sx-grid"/><text x={left-6} y={y(v)+4} textAnchor="end">{Math.round(v)}%</text></g>)}
    <line x1={x(50)} x2={x(50)} y1={top} y2={bottom} className="sx-grid"/>
    {points.map(p => <circle key={p.identity} cx={x(p.entryPct)} cy={y(p.winRate)} r={2+Math.sqrt(p.n)/2} className={p.winRate > 0 ? 'sx-strategy-point' : 'sx-record'}><title>{p.n} paired outcomes; entry {p.entryPct.toFixed(1)}% of observed bid span; captured wins {p.winRate.toFixed(1)}%</title></circle>)}
    <text x={left} y="197">First bid / 0%</text><text x={right} y="197" textAnchor="end">Terminal bid / 100%</text><text x={(left+right)/2} y="221" textAnchor="middle">Mean entry point in the observed bid span</text>
  </svg>;
}

export default function StackExploreOverview({ dataset, onOpen }: { dataset: StudyDataset; onOpen: (id: string) => void }) {
  const readings = useMemo(() => ({
    raises: evaluateBidExpression(dataset, base),
    pacing: evaluateBidExpression(dataset, { ...base, measure: 'spacing' }),
    years: evaluateBidExpression(dataset, { ...base, grouping: 'year' }),
    actors:participantBehaviorMap(dataset,base),
  }), [dataset]);
  const repeatedN = readings.actors.length;
  const middle = readings.raises.median;
  if (!readings.raises.groups.length) return <p className="sx-state">No complete, measured sequence in this retained population. No chart is substituted.</p>;
  return <section className="sx-overview">
    <div className="sx-kicker">One corpus / Many questions</div>
    <h2>Compare the behavior behind the bids.</h2>
    <p className="sx-overview-intro">Compare the markets. Follow the participants. Move through time. Choose a view to change the measure and inspect what contributes.</p>
    {middle !== null && <div className="sx-overview-finding"><strong>{percent(middle)}</strong><span>Median typical raise across {readings.raises.values.length.toLocaleString()} measured auctions.<small>Each auction contributes its median relative raise. This is the middle of those records.</small></span></div>}
    <div className="sx-overview-grid">
      <button type="button" className="sx-preview" onClick={() => onOpen('SA')}><span className="sx-preview-id">SA / Bidding behavior <b>Explore →</b></span><h3>How strongly do they raise?</h3><MiniDistribution groups={readings.raises.groups} /><span className="sx-preview-note">Six most captured makes · mean of auction medians · relative raises, log %</span></button>
      <button type="button" className="sx-preview" onClick={() => onOpen('S18')}><span className="sx-preview-id">S18 / Behavior over time <b>Explore →</b></span><h3>Calendar snapshots, 2016–2026</h3><MiniCalendar groups={readings.years.groups} /><span className="sx-preview-note">Typical relative raise · band is observed spread · sampled mix changes; 2026 is partial</span></button>
      <button type="button" className="sx-preview" onClick={() => onOpen('S03')}><span className="sx-preview-id">S03 / Participant records <b>Explore →</b></span><h3>Entry timing and captured wins</h3><MiniParticipants points={readings.actors} /><span className="sx-preview-note">{repeatedN.toLocaleString()} participants · {readings.actors.reduce((n,p) => n + p.n,0).toLocaleString()} paired records · ≥5 per point · size = count. Completed-span timing; no causal or skill claim.</span></button>
      <button type="button" className="sx-preview" onClick={() => onOpen('S21')}><span className="sx-preview-id">S21 / Bid pacing <b>Explore →</b></span><h3>Where does bidding move faster?</h3><MiniDistribution groups={readings.pacing.groups} spacing /><span className="sx-preview-note">Mean of auction median gaps · six most captured makes · log time</span></button>
    </div>
    <p className="sx-chart-note">Public sold BaT episodes, sampled by calendar quarter. These are observed comparisons; bidder skill and final-bid prediction need separate outcome tests.</p>
  </section>;
}
