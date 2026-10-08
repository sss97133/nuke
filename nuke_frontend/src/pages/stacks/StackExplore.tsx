import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import catalog from './stackCatalog.json';
import { evaluateBidExpression, quantile, MIN_DISTRIBUTION, type BidGrouping, type BidMeasure, type MeasurementGroup, type MeasurementResult, type StudyDataset } from './bidMeasurements';
import { expressionFromParams } from './bidExpression';
import { useBidPopulation, useBidStudy, type PopulationRequest } from './bidPopulationReader';
import StackExploreOverview from './StackExploreOverview';
import './stackExplore.css';

const bindings: Record<string, { label: string; grouping: BidGrouping; measure: BidMeasure; boundary: string }> = {
  SA: { label: 'Bidding behavior', grouping: 'make', measure: 'typical', boundary: 'Descriptive bid measurements; the complete order-book baseline and prediction are separate.' },
  S03: { label: 'Participant records', grouping: 'participant', measure: 'winRate', boundary: 'Captured participation records, not lifetime records or tested participant effects.' },
  S18: { label: 'Behavior over time', grouping: 'year', measure: 'typical', boundary: 'Calendar measurements; seasonal decomposition, macro attribution and forecasts are not included.' },
  S21: { label: 'Bid pacing', grouping: 'make', measure: 'spacing', boundary: 'Observed spacing distributions; no fitted probability of the next bid.' },
};
const familyNames: Record<string, string> = { bidding: 'Bidding & demand', people: 'People & reputation', economics: 'Economics & liquidity', asset: 'The physical asset', geography: 'Place & movement', information: 'Information & attention', counterfactuals: 'Counterfactuals', machine: 'The machine' };
const measures: Record<BidMeasure, { label: string; unit: string }> = {
  amount: { label: 'Mean bid', unit: 'Source-listed USD' }, increment: { label: 'Mean raise', unit: 'Source-listed USD' },
  relative: { label: 'Mean relative raise', unit: '% of preceding bid' }, typical: { label: 'Typical relative raise', unit: 'Mean of record medians · %' }, spacing: { label: 'Median bid spacing', unit: 'Seconds' },
  entry:{label:'Entry timing',unit:'% of observed first-to-terminal bid span'},
  winRate: {label:'Captured win conversion',unit:'% of attributed auction outcomes'},
  participants: { label: 'Participants per auction', unit: 'Canonical identities' }, bids: { label: 'Bids per record', unit: 'Bids' },
};
const groupNames: Record<BidGrouping, string> = { make: 'Make', model: 'Model label', year: 'Bid calendar year', participant: 'Participant', auction: 'Auction' };
const format = (metric: BidMeasure, v: number, compact = false) => {
  if (metric === 'amount' || metric === 'increment') return '$' + (compact && v >= 1000 ? (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k' : v.toLocaleString('en-US', { maximumFractionDigits: compact ? 0 : 2 }));
  if (metric === 'relative' || metric === 'typical' || metric === 'winRate' || metric === 'entry') return v.toLocaleString('en-US', { maximumFractionDigits: compact ? 1 : 2 }) + '%';
  if (metric === 'spacing') return v >= 86400 ? (v / 86400).toFixed(1) + 'd' : v >= 3600 ? (v / 3600).toFixed(1) + 'h' : v >= 60 ? (v / 60).toFixed(1) + 'm' : v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + 's';
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
};
type Change = (changes: Record<string, string | null>) => void;
function usePlotWidth() {
  const [node,setNode] = useState<HTMLDivElement | null>(null), [width, setWidth] = useState(600);
  useEffect(() => { if (!node) return; const resize = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width))); resize.observe(node); return () => resize.disconnect(); }, [node]);
  return { ref:setNode, width };
}
function numericScale(values: number[], left: number, right: number, allowLog: boolean) {
  let lo = Math.min(...values), hi = Math.max(...values); if (lo === hi) { lo = Math.max(0, lo - 1); hi += 1; }
  const log = allowLog && lo > 0 && hi / lo > 50;
  const l = log ? Math.log10(lo) - .1 : Math.max(0, lo - (hi - lo) * .06), h = log ? Math.log10(hi) + .1 : hi + (hi - lo) * .06;
  const x = (v: number) => left + ((log ? Math.log10(v) : v) - l) / (h - l) * (right - left);
  const ticks = Array.from({ length: 4 }, (_, i) => log ? 10 ** (l + (h - l) * i / 3) : l + (h - l) * i / 3);
  return { x, ticks, log };
}
function DistributionPlot({ result, selected, onSelect }: { result: MeasurementResult; selected: string | null; onSelect: (g: MeasurementGroup) => void }) {
  const { ref, width } = usePlotWidth(), [shownN,setShownN] = useState(10);
  const participant = result.expression.grouping === 'participant', wins = result.expression.measure === 'winRate';
  const meaningful = participant ? result.groups.filter(g => g.lotIds.length >= (wins ? 5 : 2)) : result.groups;
  const ordered = result.expression.grouping === 'auction' || wins ? [...meaningful].sort((a, b) => b.mean - a.mean) : meaningful;
  const groups = ordered.slice(0,shownN);
  if (!groups.length) return <p className="sx-state">{participant ? 'No repeated canonical participant in this scope. Expand the period or read another population.' : 'No supported measurements in this scope.'}</p>;
  const left = width < 480 ? 12 : 22, right = width - 20, all = [...result.values, ...groups.map(g => g.mean), ...(wins ? [0,100] : [])];
  const scale = numericScale(all, left, right, !['participants', 'bids'].includes(result.expression.measure));
  const {x,ticks,log} = ['winRate','entry'].includes(result.expression.measure) ? {x:(v:number) => left + v / 100 * (right - left),ticks:[0,25,50,75,100],log:false} : scale;
  const populationQ25 = quantile(result.values, .25)!, populationQ75 = quantile(result.values, .75)!;
  const auction = result.expression.grouping === 'auction';
  return <div ref={ref} className="sx-distributions">
    <div className={`sx-chart-key${wins ? ' sx-win-key' : ''}`}><span>{wins ? 'Observed win conversion' : 'Mean marker'}</span><span>{wins ? 'Dashed line: eligible peer median' : `Middle 50% of ${auction ? 'population' : 'group'} records`}</span><span>{wins ? 'Wins / attributed outcomes in the row heading' : 'Individual records'}</span><span className="sx-push">{log ? 'Log scale' : 'Linear scale'} · dashed line = selected population median</span></div>
    <svg width="100%" viewBox={`0 0 ${width} 45`} role="img" aria-label={`${measures[result.expression.measure].label} axis`}>
      {ticks.map((t, i) => <text key={i} x={x(t)} y="16" textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{format(result.expression.measure, t, true)}</text>)}
      <text x={width / 2} y="39" textAnchor="middle">{measures[result.expression.measure].label} · {measures[result.expression.measure].unit}</text>
    </svg>
    {auction && result.values.length >= MIN_DISTRIBUTION && <svg width="100%" viewBox={`0 0 ${width} 48`} role="img" aria-label="Shared population reference: individual auction values and middle fifty percent">
      <text x={left} y="10">Selected population · n {result.values.length}</text>
      <rect x={x(populationQ25)} y="25" width={Math.max(0,x(populationQ75) - x(populationQ25))} height="10" className="sx-iqr" />
      {result.values.map((v,i) => <circle key={i} cx={x(v)} cy={30} r="2" className="sx-record" />)}
      {result.median !== null && <line x1={x(result.median)} x2={x(result.median)} y1="20" y2="43" className="sx-reference" />}
    </svg>}
    {groups.map(g => <button key={g.key} type="button" className="sx-distribution-row" aria-pressed={selected === g.key} onClick={() => onSelect(g)}
      aria-label={`Explore ${participant ? `${g.lotIds.length} sampled auctions, ${g.label}` : g.label}, mean ${format(result.expression.measure, g.mean)}, ${g.values.length} records`}>
      <span className="sx-group-head"><strong>{participant ? `${g.lotIds.length} auctions · ${g.wins} ${g.wins === 1 ? 'win' : 'wins'} / ${g.knownOutcomes} known outcomes` : g.label}</strong><span className="sx-group-value" title={`Empirical midrank percentile ${g.percentile.toFixed(1)} in this captured selection`}>{(participant ? g.supported : result.rankValues.length >= MIN_DISTRIBUTION) ? (g.percentile > 99 ? '>P99' : g.percentile < 1 ? '<P1' : `P${Math.round(g.percentile)}`) : 'Sparse'}<small>sample · {result.rankValues.length} {participant ? 'peers' : 'records'}</small></span><span className="sx-group-count">{format(result.expression.measure, g.mean)}<small>{result.median !== null && result.median > 0 ? `${(g.mean / result.median).toFixed(1)}× median · ` : ''}n {g.values.length}</small></span></span>
      <svg width="100%" viewBox={`0 0 ${width} 46`} role="img" aria-label={`${g.label}, observed record distribution`}>
        {ticks.map((t, i) => <line key={i} x1={x(t)} x2={x(t)} y1="3" y2="43" className="sx-grid" />)}
        {result.median !== null && <line x1={x(result.median)} x2={x(result.median)} y1="3" y2="43" className="sx-reference" />}
        {!wins && g.values.map((v, i) => <circle key={g.members[i].id} cx={x(v)} cy={23 + ((i % 3) - 1) * 6} r="2" className="sx-record" />)}
        {!wins && g.values.length >= MIN_DISTRIBUTION && <rect x={x(g.q25)} y="18" width={Math.max(0, x(g.q75) - x(g.q25))} height="10" className="sx-iqr" />}
        <line x1={x(g.mean)} x2={x(g.mean)} y1="10" y2="36" className="sx-mean" />
      </svg>
    </button>)}
    <p className="sx-chart-note">P = empirical percentile of this mean among {result.rankValues.length.toLocaleString()} selected {participant ? `participant means (at least ${wins ? 5 : 2} attributed records each)` : 'auction records'}. Captured sample positions, not population estimates. {result.expression.grouping === 'auction' && 'Highest measured value first; the shared gray interval above belongs to the whole population.'}</p>
    {ordered.length > shownN && <button type="button" className="sx-text-button" onClick={() => setShownN(n => n + 20)}>Show {Math.min(20,ordered.length - shownN)} more · {ordered.length} groups in this selection</button>}
    {participant && <p className="sx-chart-note">{wins ? 'At least five attributed outcomes · highest captured conversion first · no vehicle-mix adjustment or skill claim.' : 'Repeated participants only · one participant–auction record per dot.'} Handles appear in the contributor inspection.</p>}
  </div>;
}
function CalendarPlot({ result, onSelect, selected }: { result: MeasurementResult; onSelect: (g: MeasurementGroup) => void; selected: string | null }) {
  const { ref, width } = usePlotWidth(), [hover, setHover] = useState<MeasurementGroup | null>(null);
  const groups = result.groups, metric = result.expression.measure, h = 350, left = 66, right = width - 18, top = 36, bottom = 282;
  if (!groups.length) return null;
  const low = Math.min(0, ...groups.map(g => Math.min(g.q25, g.mean))), high = Math.max(...groups.map(g => Math.max(g.q75, g.mean))) * 1.12 || 1;
  const y = (v: number) => bottom - (v - low) / (high - low) * (bottom - top), x = (year: number) => result.expression.from === result.expression.to ? (left + right) / 2 : left + (year - result.expression.from + .15) / (Math.max(1, result.expression.to - result.expression.from) + .3) * (right - left);
  const yearMap = new Map(groups.map(g => [g.year, g]));
  const segments: MeasurementGroup[][] = []; let segment: MeasurementGroup[] = [];
  for (let year = result.expression.from; year <= result.expression.to; year++) { const g = yearMap.get(year); if (g?.supported) segment.push(g); else { if (segment.length) segments.push(segment); segment = []; } } if (segment.length) segments.push(segment);
  const display = hover ?? groups.find(g => g.key === selected) ?? groups[groups.length - 1];
  return <div ref={ref} className="sx-calendar">
    <div className="sx-chart-key"><span>Annual mean</span><span>Middle 50% of auction-year readings</span><span>Band is spread, not confidence</span></div>
    <svg width="100%" viewBox={`0 0 ${width} ${h}`} role="img" aria-label={`${measures[metric].label} by bid calendar year, with auction-year distributions`}>
      <rect x={left} y={top} width={right - left} height={bottom - top} className="sx-frame" />
      {[0, 1, 2, 3, 4].map(i => { const v = low + (high - low) * i / 4; return <g key={i}><line x1={left} x2={right} y1={y(v)} y2={y(v)} className="sx-grid" /><text x={left - 9} y={y(v) + 4} textAnchor="end">{format(metric, v, true)}</text></g>; })}
      {segments.map((s, i) => <g key={i}><path d={s.map((g, j) => `${j ? 'L' : 'M'}${x(g.year!)},${y(g.q25)}`).join(' ') + s.slice().reverse().map(g => `L${x(g.year!)},${y(g.q75)}`).join(' ') + 'Z'} className="sx-iqr" /><path d={s.map((g, j) => `${j ? 'L' : 'M'}${x(g.year!)},${y(g.mean)}`).join(' ')} className="sx-time-line" /></g>)}
      {groups.map(g => <g key={g.key}><circle cx={x(g.year!)} cy={y(g.mean)} r={g.key === selected ? 6 : 4} className={g.supported ? 'sx-time-point' : 'sx-sparse-point'} /><circle cx={x(g.year!)} cy={y(g.mean)} r="18" fill="transparent" onPointerEnter={() => setHover(g)} onPointerLeave={() => setHover(null)} onClick={() => onSelect(g)} />{(width > 500 || g.year === result.expression.from || g.year === result.expression.to || g.year === Math.round((result.expression.from + result.expression.to) / 2)) && <text x={x(g.year!)} y={bottom + 24} textAnchor="middle">{g.year}</text>}</g>)}
      <text x={left} y="18">{measures[metric].label} · {measures[metric].unit}</text><text x={(left + right) / 2} y={h - 12} textAnchor="middle">Bid event calendar year · UTC</text>
    </svg>
    <div className="sx-year-reading" aria-live="polite"><strong>{display.year}</strong><b>{format(metric, display.mean)}</b><span>{display.values.length} auction-year records · {display.observations.toLocaleString()} observations{display.supported ? '' : ' · insufficient for a connected trend'}</span></div>
    <div className="sx-year-buttons" aria-label="Inspect a year">{groups.map(g => <button type="button" key={g.key} aria-pressed={selected === g.key} onClick={() => onSelect(g)}>{g.year}<small>n {g.values.length}</small></button>)}</div>
  </div>;
}
function ContributorInspection({ dataset, result, group, query }: { dataset: StudyDataset; result: MeasurementResult; group: MeasurementGroup; query: string }) {
  const metric = result.expression.measure, winMeasure = result.expression.measure === 'winRate', lots = new Map(dataset.lots.map(l => [l.id, l]));
  const members = [...group.members].sort((a, b) => b.value - a.value), shown = members.slice(0, 30);
  const actor = result.expression.grouping === 'participant';
  const observedResults = actor ? group.lotIds.map(id => lots.get(id)!).filter(l => l.winner) : [];
  const wins = actor ? observedResults.filter(l => l.winner === group.key).length : 0;
  return <section className="sx-contributors" aria-labelledby="sx-contributor-title">
    <div className="sx-section-head"><h3 id="sx-contributor-title">{actor ? 'Selected participant’s captured record' : group.label} · contributors</h3><span>{group.lotIds.length} auctions</span></div>
    {actor && <p className="sx-chart-note">{group.label} · {observedResults.length ? `${wins} recorded wins / ${observedResults.length} known winner records in this sample` : 'Winner attribution unavailable in this slice'}. This is not a lifetime record or a skill estimate.</p>}
    <div className="sx-table-scroll"><table><thead><tr><th>Contributing auction</th><th>{measures[metric].label}</th><th>Observations</th>{!winMeasure && <th>Sample position</th>}</tr></thead><tbody>{shown.map(m => {
      const l = lots.get(m.lotId)!;
      const position = result.values.length >= MIN_DISTRIBUTION ? 100 * (result.values.filter(v => v < m.value).length + .5 * result.values.filter(v => v === m.value).length) / result.values.length : null;
      return <tr key={m.id}><td><Link to={`/stacks/order-book/${m.vehicleId}?lot=${m.lotId}&back=${encodeURIComponent(query)}`}>{m.title}</Link><small>{l.end.slice(0, 10)} · sold · source-linked</small></td><td className="sx-number">{winMeasure ? (m.value === 100 ? 'Recorded win' : 'Did not win') : format(metric, m.value)}</td><td className="sx-number">{m.observations}</td>{!winMeasure && <td className="sx-number">{position === null ? 'Sparse' : `P${Math.round(position)}`}</td>}</tr>;
    })}</tbody></table></div>
    {members.length > shown.length && <p className="sx-chart-note">Showing {shown.length} of {members.length} contributing records, ordered by the selected measure. Narrow the scope to inspect a smaller set.</p>}
  </section>;
}
function DefinitionView({ id, change }: { id: string; change: Change }) {
  const definition = catalog.find(c => c.id === id)!;
  return <section className="sx-definition"><div className="sx-kicker">{definition.id} / {familyNames[definition.family]} / Definition</div><h2>{definition.name}</h2><p className="sx-definition-question">{definition.question}</p><p>This question is in the tracked stack catalogue. Its complete analytical reader is not connected to this workbench. No result or readiness percentage is inferred from the definition.</p><div className="sx-related"><span className="sx-kicker">Available measurements</span>{Object.entries(bindings).map(([key, b]) => <button type="button" key={key} onClick={() => change({ stack: key, by: b.grouping, measure: b.measure, group: null })}>{b.label} →</button>)}</div><details><summary>Definition source</summary><p>Publicly tracked registry seed, October 7, 2026; case ledger §13. This is definition text, not protected runtime registry metadata or a current capability audit.</p></details></section>;
}

export default function StackExplore() {
  const [params, setParams] = useSearchParams(), [search, setSearch] = useState('');
  const change: Change = changes => setParams(previous => { const next = new URLSearchParams(previous); for (const [k, v] of Object.entries(changes)) { if (v === null) next.delete(k); else next.set(k, v); } return next; });
  const selectedStack = catalog.some(c => c.id === params.get('stack')) ? params.get('stack')! : 'overview', binding = bindings[selectedStack];
  const expression = useMemo(() => expressionFromParams(params), [params]), study = useBidStudy();
  const request: PopulationRequest | null = params.get('source') === 'read' ? { make: expression.make, model: null, year: expression.to } : null;
  const read = useBidPopulation(request), dataset = request ? read.data : study.data;
  const result = useMemo(() => dataset ? evaluateBidExpression(dataset, expression) : null,
    [dataset, expression]);
  const activeQuery = request ? read : study, definition = catalog.find(c => c.id === selectedStack);
  const selectedGroup = result?.groups.find(g => g.key === params.get('group')) ?? null;
  const filtered = catalog.filter(c => `${c.name} ${c.question} ${familyNames[c.family]}`.toLowerCase().includes(search.toLowerCase()));
  const makeOptions = useMemo(() => [...new Map([...(expression.make ? [expression.make] : []), ...(dataset?.lots ?? []).map(l => l.make)].map(make => [make.toLowerCase(),make])).values()].sort((a, b) => a.localeCompare(b)), [dataset,expression.make]);
  const modelOptions = useMemo(() => [...new Set([...(expression.model ? [expression.model] : []), ...(dataset?.lots ?? []).filter(l => !expression.make || l.make.toLowerCase() === expression.make.toLowerCase()).map(l => l.model)])].sort(), [dataset, expression.make,expression.model]);
  const vehicleYears = [...new Set([...(expression.vehicleYear ? [expression.vehicleYear] : []), ...(dataset?.lots ?? []).filter(l => (!expression.make || l.make.toLowerCase() === expression.make.toLowerCase()) && (!expression.model || l.model === expression.model)).map(l => l.vehicleYear).filter((y): y is number => y !== null)])].sort((a,b) => b - a);
  const years = Array.from({ length: new Date().getUTCFullYear() - 2014 + 1 }, (_, i) => 2014 + i);
  const pick = (g: MeasurementGroup) => {
    if (expression.grouping === 'make') change({ make: g.make!, model: null, vehicleYear: null, by: 'model', group: null });
    else if (expression.grouping === 'model') change({ make: g.make!, model: g.model!, by: 'auction', group: null });
    else change({ group: selectedGroup?.key === g.key ? null : g.key });
  };
  const chooseStack = (id: string) => { const b = bindings[id]; change({ stack: id, group: null, ...(b ? { by: b.grouping, measure: b.measure } : {}) }); };
  return <main className="sx-page">
    <header className="sx-page-head"><div><div className="sx-kicker">Explore the data</div><h1>Stacks</h1></div><span className="sx-corpus">{dataset ? `${dataset.lots.length.toLocaleString()} auctions · ${dataset.lots.reduce((s, l) => s + l.sums.bids, 0).toLocaleString()} bids` : 'Recorded bid study'}<small>Sold BaT sample · source reconstruction</small></span></header>
    <div className="sx-layout"><aside className="sx-index" aria-label="Stack questions">
      <label className="sx-search"><span className="sx-kicker">Find a question</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Bidders, liquidity, condition…" /></label>
      <button type="button" className="sx-overview-link" aria-pressed={selectedStack === 'overview'} onClick={() => change({ stack: null, source: null, make: null, model: null, vehicleYear: null, group: null })}>Overview <span>Four views of the corpus →</span></button>
      <div className="sx-index-heading"><span className="sx-kicker">Measurements available</span><span>{Object.keys(bindings).length}</span></div>
      {filtered.filter(c => bindings[c.id]).map(c => <button type="button" key={c.id} className="sx-question" aria-pressed={selectedStack === c.id} onClick={() => chooseStack(c.id)}><span className="sx-question-id">{c.id}</span><span><strong>{bindings[c.id].label}</strong><small>{c.name}</small></span><span aria-hidden="true">↗</span></button>)}
      <div className="sx-index-heading"><span className="sx-kicker">Stack definitions</span><span>{catalog.length}</span></div>
      <div className="sx-catalog-scroll">{Object.entries(familyNames).map(([family, label]) => {
        const rows = filtered.filter(c => c.family === family && !bindings[c.id]); if (!rows.length) return null;
        return <details key={family} className="sx-family" open={search ? true : undefined}><summary>{label}<small>{rows.length}</small></summary>{rows.map(c => <button type="button" key={c.id} className="sx-definition-row" aria-pressed={selectedStack === c.id} onClick={() => chooseStack(c.id)}><span>{c.id}</span>{c.name}</button>)}</details>;
      })}</div>
      {!filtered.length && <p className="sx-chart-note">No definition matches this search.</p>}
    </aside><div className="sx-workbench">
      {selectedStack === 'overview' ? <>{study.isPending && <div className="sx-loading" role="status">Reading the captured population…</div>}{study.isError && <p className="sx-state" role="status">The retained study could not be loaded. <button type="button" onClick={() => void study.refetch()}>Try again</button></p>}{study.data && <StackExploreOverview dataset={study.data} onOpen={id => { const b = bindings[id]; change({ stack:id, by:b.grouping, measure:b.measure, from:'2016', to:String(new Date().getUTCFullYear()), make:null, model:null, vehicleYear:null, source:null, group:null, weight:null }); }} />}</> : !binding ? <DefinitionView id={selectedStack} change={change} /> : <>
        <div className="sx-kicker">{selectedStack} / {binding.label} / Descriptive measurements</div>
        <h2>{expression.grouping === 'year' ? 'How has bidding changed over time?' : expression.grouping === 'participant' ? (expression.measure === 'winRate' ? 'Who turns participation into wins?' : 'How differently do the participants bid?') : 'How differently do these markets bid?'}</h2>
        <div className="sx-breadcrumb"><button type="button" onClick={() => change({ make: null, model: null, vehicleYear:null, by: 'make', group: null, source: null })}>All sampled makes</button>{expression.make && <><span>›</span><button type="button" onClick={() => change({ model: null, by: 'model', group: null })}>{expression.make}</button></>}{expression.model && <><span>›</span><strong>{expression.model}</strong></>}</div>
        <div className="sx-expression" aria-label="Measurement expression"><label>Measure<select value={expression.measure} onChange={e => change({ measure: e.target.value, group: null })}>{Object.entries(measures).filter(([m]) => !(expression.grouping === 'participant' && m === 'participants') && !(expression.grouping !== 'participant' && ['winRate','entry'].includes(m))).map(([m, label]) => <option value={m} key={m}>{label.label}</option>)}</select></label><label>Group by<select value={expression.grouping} onChange={e => change({ by: e.target.value, group: null, ...(e.target.value === 'participant' && expression.measure === 'participants' ? { measure: 'bids' } : e.target.value !== 'participant' && ['winRate','entry'].includes(expression.measure) ? { measure:'typical' } : {}) })}>{Object.entries(groupNames).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label><label>Bid year from<select value={expression.from} onChange={e => change({ from: e.target.value, to: String(Math.max(Number(e.target.value), expression.to)), group: null })}>{years.map(y => <option key={y}>{y}</option>)}</select></label><label>To<select value={expression.to} onChange={e => change({ to: e.target.value, from: String(Math.min(expression.from, Number(e.target.value))), group: null })}>{years.map(y => <option key={y}>{y}</option>)}</select></label><label>Weighting<select value={expression.weighting} disabled={!['amount', 'increment', 'relative'].includes(expression.measure)} onChange={e => change({ weight: e.target.value, group: null })}><option value="auction">Each record equally</option><option value="bid">Each bid / raise equally</option></select></label></div>
        <div className="sx-filters"><label>Make<select value={expression.make ?? ''} onChange={e => change({ make: e.target.value || null, model: null, vehicleYear: null, group: null, source: null })}><option value="">All sampled makes</option>{makeOptions.map(m => <option key={m}>{m}</option>)}</select></label><label>Model label<select value={expression.model ?? ''} onChange={e => change({ model: e.target.value || null, vehicleYear: null, group: null })}><option value="">All model labels</option>{modelOptions.map(m => <option key={m}>{m}</option>)}</select></label>{expression.make && <label>Vehicle model year<select value={expression.vehicleYear ?? ''} onChange={e => change({ vehicleYear:e.target.value || null, group:null })}><option value="">All vehicle years</option>{vehicleYears.map(y => <option key={y}>{y}</option>)}</select></label>}<button type="button" className="sx-read-button" disabled={read.isFetching} onClick={() => { if (request) void read.refetch(); else change({ source: 'read', from: String(expression.to), group: null }); }}>{read.isFetching ? 'Reading…' : `Read current ${expression.make ?? 'BaT'} · ${expression.to}`}</button>{request && <button type="button" className="sx-text-button" onClick={() => change({ source: null, group: null })}>Return to retained study</button>}</div>
        {activeQuery.isPending && <div className="sx-loading" role="status">Reading the selected population…</div>}
        {activeQuery.isError && <div className="sx-state" role="status">The selected evidence could not be read{dataset ? '; the previous completed reading is retained below' : '; no measurement is substituted'}. <button type="button" onClick={() => void activeQuery.refetch()}>Try again</button></div>}
        {result && dataset && <>
          <div className="sx-measure-heading"><h3>{measures[expression.measure].label} by {groupNames[expression.grouping].toLowerCase()}</h3><span>{expression.measure === 'winRate' ? `${result.rankValues.length} ranked participants · ≥5 attributed outcomes each` : `${result.contributingLots.toLocaleString()} auctions · ${result.values.length.toLocaleString()} records`}</span></div>
          <p className="sx-selection-note">{request ? `Bounded recent-first ${expression.to} read` : 'Quarter-stratified retained sample · 2016–2026'} · complete sold sequences · {expression.weighting === 'bid' && ['amount', 'increment', 'relative'].includes(expression.measure) ? 'bid / raise weighted' : 'equal record weight'}</p>
          {expression.grouping === 'year' ? <CalendarPlot result={result} onSelect={pick} selected={selectedGroup?.key ?? null} /> : <DistributionPlot key={[expression.measure,expression.grouping,expression.make,expression.model,expression.vehicleYear,expression.from,expression.to].join(':')} result={result} onSelect={pick} selected={selectedGroup?.key ?? null} />}
          {selectedGroup && <ContributorInspection dataset={dataset} result={result} group={selectedGroup} query={params.toString()} />}
          <details className="sx-method"><summary>Measurement, population & evidence receipt <span>{result.bidN.toLocaleString()} bids / {result.raiseN.toLocaleString()} valid raises</span></summary><div className="sx-method-body"><p>{binding.boundary}</p><p><strong>{definition?.name}.</strong> {definition?.question}</p><pre>{`Δᵢ = bidᵢ − preceding valid standing bid\nRelative raise = 100 × Δᵢ / preceding bid\nMean = sum / valid observation count\nBid-weighted mean = sum of member sums / sum of member counts\nEqual-record mean = mean of member measurements\nP = empirical midrank of the mean among selected records (participant means for participant views)`}</pre><p>Typical relative raise is the median of valid bid-level relative raises inside each record, then the mean of those medians within a group. This reduces the influence of very small opening bids; it does not adjust for vehicle condition or estimate bidder skill. Opening bids have no increment. Increments and spacing are formed inside complete episodes before selecting the later bid’s calendar year. Dollars are source-listed nominal USD. Relative increments can be sensitive to small opening amounts. The interval shown is the middle half of observed record values, not uncertainty around the mean.</p><p>{dataset.selection} {dataset.capped ? 'Candidate selection reached its retrieval cap.' : ''} This is not a market census or a representative market estimate. Counts and changes can reflect capture, exclusions and vehicle/participant mix. Current-year data is partial.</p><p>Model groups use the current normalized model label when present, otherwise the source label ({result.modelFallbackLots} scoped auctions). They do not establish common generation, condition or configuration. Entry timing is the first placement’s elapsed share of the completed, observed first-to-terminal bidding span. This is not the official auction opening window or an as-of forecast feature. Participant comparisons describe canonical participant × auction records held now. Win conversion uses only outcomes whose winner key agrees with the terminal bidder key, and participant percentile ranks require at least five such outcomes. {dataset.lots.filter(l => l.winnerConflict).length} captured episodes have conflicting winner keys and are withheld from win conversion. Crossing-year episodes are withheld from participant views when any part of the episode is outside the selected year window.</p><p>{dataset.knowledgeMode} Dataset read {new Date(dataset.readAt).toLocaleString()}. Method {result.method}. {dataset.lots.length} eligible / {dataset.candidateN} selected auctions; {dataset.exclusions.length} excluded. {result.withheldRecordN} missing/withheld measurement records in this selection.</p><table><thead><tr><th>Recorded close year</th><th>Candidates</th><th>Eligible episodes</th><th>Excluded</th></tr></thead><tbody>{Object.entries(dataset.candidatesByYear).map(([year, n]) => <tr key={year}><td>{year}</td><td>{n}</td><td>{dataset.lots.filter(l => l.end.startsWith(year)).length}</td><td>{dataset.exclusions.filter(e => String(e.year) === year).length}</td></tr>)}</tbody></table><details><summary>Exclusion reasons</summary><ul>{Object.entries(dataset.exclusions.reduce<Record<string, number>>((a, e) => { a[e.reason] = (a[e.reason] ?? 0) + 1; return a; }, {})).map(([reason, n]) => <li key={reason}>{n} · {reason}</li>)}</ul></details></div></details>
        </>}
      </>}
    </div></div>
  </main>;
}
