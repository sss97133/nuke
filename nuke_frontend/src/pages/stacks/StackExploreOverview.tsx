import { useMemo, useRef, useState } from 'react';
import { evaluateBidExpression, participantBehaviorMap, type ParticipantMapPoint, type BidExpression, type StudyDataset } from './bidMeasurements';

import ComparisonPlot from './ComparisonPlot';
import CalendarPlot from './CalendarPlot';
import AnalyticalHeading from './AnalyticalHeading';

const base: BidExpression = { measure: 'typical', grouping: 'make', from: 2016, to: new Date().getUTCFullYear(), make: null, model: null, weighting: 'auction' };

function MiniParticipants({points,onSelect}:{points:ParticipantMapPoint[];onSelect:(identity:string) => void}) {
  const [activeIndex,setActiveIndex] = useState(0);
  const nodes = useRef<Array<SVGGElement | null>>([]);
  const left=46,right=460,top=34,bottom=174;
  const maxRate=Math.max(25,Math.ceil(Math.max(0,...points.map(p => p.winRate)) / 25) * 25);
  const x=(v:number) => left + v / 100 * (right-left), y=(v:number) => bottom-v/maxRate*(bottom-top);
  return <svg viewBox="0 0 480 228" role="group" aria-label="Participant behavior map: average entry timing versus captured win conversion, paired attributed outcomes only">
    <text x={left} y="15">Captured wins / attributed outcomes (%)</text>
    {[0,maxRate/2,maxRate].map((v,i) => <g key={i}><line x1={left} x2={right} y1={y(v)} y2={y(v)} className="sx-grid"/><text x={left-6} y={y(v)+4} textAnchor="end">{Math.round(v)}%</text></g>)}
    <line x1={x(50)} x2={x(50)} y1={top} y2={bottom} className="sx-grid"/>
    {points.map((p,i) => <g key={p.identity} role="button" ref={node => {nodes.current[i]=node;}} tabIndex={i === activeIndex ? 0 : -1} onFocus={() => setActiveIndex(i)} aria-label={`Inspect participant: ${p.n} paired auctions, entry ${p.entryPct.toFixed(1)}%, captured wins ${p.winRate.toFixed(1)}%`} onClick={() => onSelect(p.identity)} onKeyDown={e => {if(e.key === 'Enter' || e.key === ' ') {e.preventDefault();onSelect(p.identity);} else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {e.preventDefault();const next=(i + (['ArrowRight','ArrowDown'].includes(e.key) ? 1 : -1) + points.length) % points.length;setActiveIndex(next);nodes.current[next]?.focus();}}}><circle cx={x(p.entryPct)} cy={y(p.winRate)} r="10" fill="transparent" /><circle cx={x(p.entryPct)} cy={y(p.winRate)} r="3.5" className="sx-strategy-point" /><title>{p.n} paired outcomes; entry {p.entryPct.toFixed(1)}%; captured wins {p.winRate.toFixed(1)}%</title></g>)}
    <text x={left} y="197">First bid / 0%</text><text x={right} y="197" textAnchor="end">Terminal bid / 100%</text><text x={(left+right)/2} y="221" textAnchor="middle">Mean entry point in the observed bid span</text>
  </svg>;
}

export default function StackExploreOverview({ dataset, onOpen }: { dataset: StudyDataset; onOpen: (id: string, scope?: Record<string,string|null>) => void }) {
  const [makePage, setMakePage] = useState(0);
  const readings = useMemo(() => ({
    raises: evaluateBidExpression(dataset, base),
    pacing: evaluateBidExpression(dataset, { ...base, measure: 'spacing' }),
    years: evaluateBidExpression(dataset, { ...base, grouping: 'year' }),
    actors:participantBehaviorMap(dataset,base),
  }), [dataset]);
  const repeatedN = readings.actors.length;
  if (!readings.raises.groups.length) return <p className="sx-state">No complete, measured sequence in this retained population. No chart is substituted.</p>;
  return <section className="sx-overview">
    <h2>Compare the behavior behind the bids.</h2>
    <div className="sx-overview-grid">
      <section className="sx-preview" aria-label="Raise size by make">
        <AnalyticalHeading expression={base} measureLabel="Raise size" onChange={patch => onOpen('SA',patch)}><button type="button" className="sx-text-button" aria-label="Explore raise size by make" onClick={() => onOpen('SA')}>Explore →</button></AnalyticalHeading>
        <span className="sx-preview-measure">Average auction median raise · % of preceding bid</span>
        <ComparisonPlot compact result={readings.raises} groups={readings.raises.groups.slice(makePage*6,makePage*6+6)} scaleGroups={readings.raises.groups} referenceName={`All sampled makes · ${readings.raises.values.length.toLocaleString()} auctions`} onSelect={g => onOpen('SA',{make:g.make!,by:'model'})} />
        <div className="sx-make-pages" aria-label="Browse makes"><button type="button" disabled={makePage === 0} onClick={() => setMakePage(p => p-1)}>Previous</button><span>{makePage*6+1}–{Math.min(makePage*6+6,readings.raises.groups.length)} / {readings.raises.groups.length}</span><button type="button" disabled={(makePage+1)*6 >= readings.raises.groups.length} onClick={() => setMakePage(p => p+1)}>Next</button><button type="button" className="sx-text-button" onClick={() => onOpen('SA')}>All {readings.raises.groups.length} makes →</button></div>
        <span className="sx-preview-note">Captured make labels · same axis and reference on every page.</span>
      </section>
      <section className="sx-preview" aria-label="Behavior over time">
        <button type="button" className="sx-preview-title" onClick={() => onOpen('S18')}><h3>Bidding through time</h3><span>Explore →</span></button>
        <CalendarPlot compact result={readings.years} onSelect={g => onOpen('S18',{group:g.key})} />
      </section>
      <section className="sx-preview" aria-label="Participant behavior">
        <button type="button" className="sx-preview-title" onClick={() => onOpen('S03')}><h3>When do the winners enter?</h3><span>Explore →</span></button>
        {repeatedN > 0 && <><span className="sx-preview-measure">One dot = one participant · ≥5 paired auctions each</span><MiniParticipants points={readings.actors} onSelect={identity => onOpen('S03',{group:identity,paired:'entry-outcome'})} /></>}
        <span className="sx-preview-note">{repeatedN.toLocaleString()} participants · {readings.actors.reduce((n,p) => n + p.n,0).toLocaleString()} paired records · completed observed bid span.</span>
      </section>
      <section className="sx-preview" aria-label="Bid pacing by make">
        <AnalyticalHeading expression={{...base,measure:'spacing'}} measureLabel="Bid pacing" onChange={patch => onOpen('S21',patch)}><button type="button" className="sx-text-button" aria-label="Explore bid pacing by make" onClick={() => onOpen('S21')}>Explore →</button></AnalyticalHeading>
        <span className="sx-preview-measure">Average auction median gap · time between bids</span>
        <ComparisonPlot compact result={readings.pacing} groups={readings.pacing.groups.slice(0,6)} scaleGroups={readings.pacing.groups} referenceName={`All sampled makes · ${readings.pacing.values.length.toLocaleString()} auctions`} onSelect={g => onOpen('S21',{make:g.make!,by:'model'})} />
      </section>
    </div>
    <p className="sx-chart-note">Public sold BaT episodes, sampled by calendar quarter. These are observed comparisons; bidder skill and final-bid prediction need separate outcome tests.</p>
  </section>;
}
