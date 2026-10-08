import { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import catalog from './stackCatalog.json';
import { evaluateBidExpression, MIN_DISTRIBUTION, type BidGrouping, type BidMeasure, type MeasurementGroup, type MeasurementResult, type StudyDataset } from './bidMeasurements';
import { expressionFromParams } from './bidExpression';
import { useBidPopulation, useBidStudy, type PopulationRequest } from './bidPopulationReader';
import StackExploreOverview from './StackExploreOverview';
import ComparisonPlot, { MakeLogo } from './ComparisonPlot';
import { formatMeasure as format } from './stackFormat';
import CalendarPlot from './CalendarPlot';
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
  relative: { label: 'Mean relative raise', unit: '% of preceding bid' }, typical: { label: 'Average record median raise', unit: '% of preceding bid' }, spacing: { label: 'Average record median gap', unit: 'Seconds' },
  entry:{label:'Entry timing',unit:'% of observed first-to-terminal bid span'},
  winRate: {label:'Captured win conversion',unit:'% of attributed auction outcomes'},
  participants: { label: 'Participants per auction', unit: 'Canonical identities' }, bids: { label: 'Bids per record', unit: 'Bids' },
};
const groupNames: Record<BidGrouping, string> = { make: 'Make', model: 'Model label', year: 'Bid calendar year', participant: 'Participant', auction: 'Auction' };
type Change = (changes: Record<string, string | null>) => void;
function DistributionPlot({ result, selected, onSelect, dataset, query, onClose }: { result: MeasurementResult; selected: string | null; onSelect: (g: MeasurementGroup) => void; dataset: StudyDataset; query: string; onClose: () => void }) {
  const [shownN, setShownN] = useState(10);
  const participant = result.expression.grouping === 'participant', wins = result.expression.measure === 'winRate';
  const meaningful = participant ? result.groups.filter(g => g.lotIds.length >= (wins ? 5 : 2)) : result.groups;
  const ordered = result.expression.grouping === 'auction' || wins ? [...meaningful].sort((a, b) => b.mean - a.mean) : meaningful;
  // A mark or shared URL may select a record outside the displayed page.
  // Bring that record into the first page instead of requiring a long scroll.
  const selectedIndex = ordered.findIndex(g => g.key === selected);
  const groups = selectedIndex >= shownN ? [ordered[selectedIndex], ...ordered.slice(0, shownN)] : ordered.slice(0, shownN);
  if (!groups.length) return <p className="sx-state">{participant ? 'No repeated canonical participant in this scope. Expand the period or read another population.' : 'No supported measurements in this scope.'}</p>;
  const scope = [result.expression.make, result.expression.model].filter(Boolean).join(' ') || 'All sampled makes';
  const referenceName = `${participant ? 'Eligible participant averages' : scope} · ${result.rankValues.length.toLocaleString()} ${participant ? 'participants' : 'auction records'}`;
  const selectedGroup = groups.find(g => g.key === selected);
  const members = meaningful.flatMap(g => g.members);
  const referenceGroup: MeasurementGroup = { ...groups[0], key: '__reference', label: 'Selected reference population', members, lotIds: [...new Set(members.map(m => m.lotId))] };
  return <div className="sx-distributions">
    <ComparisonPlot result={result} groups={groups} scaleGroups={ordered} selected={selected} onSelect={onSelect} referenceName={referenceName}
      inspection={selectedGroup && <><div className="sx-inspection-head"><span>{format(result.expression.measure, selectedGroup.mean)} · {result.median === null ? 'Selection median unavailable' : result.median > 0 ? `${(selectedGroup.mean / result.median).toFixed(1)}× selection median` : `selection median ${format(result.expression.measure,result.median)}`}</span><button type="button" className="sx-text-button" onClick={onClose}>Close inspection</button></div><ContributorInspection dataset={dataset} result={result} group={selectedGroup} query={query} /></>}
      referenceInspection={<><p>{participant ? `The reference uses one average per participant with at least ${wins ? 5 : 2} captured auctions. The contributor table lists their underlying participant–auction records.` : 'The reference uses one reading per selected auction. Group averages and the reference median summarize different things.'}</p><ContributorInspection dataset={dataset} result={result} group={referenceGroup} query={query} reference /></>} />
    {selectedIndex >= shownN && <p className="sx-chart-note">Selected record shown first; remaining rows retain their comparison order.</p>}
    {ordered.length > groups.length && <button type="button" className="sx-text-button" onClick={() => setShownN(n => n + 20)}>Show {Math.min(20, ordered.length - groups.length)} more · {ordered.length} groups</button>}
    {participant && <p className="sx-chart-note">{wins ? '≥5 attributed outcomes per participant · highest conversion first' : 'Repeated participants only · ≥2 captured auctions'}. Captured records, without vehicle-mix adjustment or a skill estimate.</p>}
  </div>;
}
function ContributorInspection({ dataset, result, group, query, reference = false }: { dataset: StudyDataset; result: MeasurementResult; group: MeasurementGroup; query: string; reference?: boolean }) {
  const metric = result.expression.measure, winMeasure = result.expression.measure === 'winRate', lots = new Map(dataset.lots.map(l => [l.id, l]));
  const members = [...group.members].sort((a, b) => b.value - a.value), shown = members.slice(0, 30);
  const actor = result.expression.grouping === 'participant' && !reference;
  const observedResults = actor ? group.lotIds.map(id => lots.get(id)!).filter(l => l.winner) : [];
  const wins = actor ? observedResults.filter(l => l.winner === group.key).length : 0;
  return <section className="sx-contributors" aria-label={`${group.label} contributors`}>
    {!reference && <p className="sx-chart-note">{result.rankValues.length >= MIN_DISTRIBUTION ? `P${Math.round(group.percentile)} = empirical position of this ${result.expression.grouping === 'auction' ? 'auction reading' : 'group average'} among ${result.rankValues.length.toLocaleString()} ${result.rankGrain === 'participant' ? 'eligible participant averages' : result.expression.grouping === 'year' ? 'auction-year records' : 'individual auction records'}.` : 'Too few reference records for a percentile.'} {result.expression.grouping !== 'auction' && result.rankGrain !== 'participant' && `This is not a rank among ${result.expression.grouping === 'year' ? 'year' : 'make or model'} averages.`}</p>}
    <div className="sx-section-head"><h3>{actor ? 'Selected participant’s captured record' : group.label} · contributors</h3><span>{group.lotIds.length} auctions</span></div>
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
  // Router search-param callbacks do not queue like React state setters. Preserve rapid
  // successive control patches while also accepting back/forward and shared-URL changes.
  const pendingParams = useRef(params);
  useEffect(() => { pendingParams.current = params; }, [params]);
  const change: Change = changes => {
    const next = new URLSearchParams(pendingParams.current);
    for (const [k, v] of Object.entries(changes)) { if (v === null) next.delete(k); else next.set(k, v); }
    pendingParams.current = next; setParams(next);
    if (['stack', 'make', 'model', 'by'].some(k => k in changes)) window.scrollTo(0, 0);
  };
  const selectedStack = catalog.some(c => c.id === params.get('stack')) ? params.get('stack')! : 'overview', binding = bindings[selectedStack];
  const expression = useMemo(() => expressionFromParams(params), [params]), study = useBidStudy();
  const request: PopulationRequest | null = params.get('source') === 'read' ? { make: expression.make, model: null, year: expression.to } : null;
  const read = useBidPopulation(request), dataset = request ? read.data : study.data;
  const paired = expression.grouping === 'participant' && params.get('paired') === 'entry-outcome';
  // A scatter point uses paired entry/outcome records. Its drill must retain that
  // denominator, including withholding zero-span episodes whose entry is undefined.
  const measurementDataset = useMemo(() => dataset && paired ? { ...dataset, lots: dataset.lots.filter(l => l.winner && l.sums.gaps.some(gap => gap > 0)) } : dataset, [dataset, paired]);
  const result = useMemo(() => measurementDataset ? evaluateBidExpression(measurementDataset, expression) : null,
    [measurementDataset, expression]);
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
  const chooseStack = (id: string) => { const b = bindings[id]; change({ stack: id, group: null, paired: null, ...(b ? { by: b.grouping, measure: b.measure } : {}) }); };
  return <main className="sx-page">
    <header className="sx-page-head"><div><div className="sx-kicker">Explore the data</div><h1>Stacks</h1></div><span className="sx-corpus">{dataset ? `${dataset.lots.length.toLocaleString()} auctions · ${dataset.lots.reduce((s, l) => s + l.sums.bids, 0).toLocaleString()} bids` : 'Recorded bid study'}<small>Sold BaT sample · source reconstruction</small></span></header>
    <div className="sx-layout"><aside className="sx-index" aria-label="Stack questions">
      <label className="sx-mobile-view">View<select value={selectedStack} onChange={e => e.target.value === 'overview' ? change({stack:null,source:null,make:null,model:null,vehicleYear:null,group:null}) : chooseStack(e.target.value)}><option value="overview">Corpus overview</option>{Object.entries(bindings).map(([id,b]) => <option key={id} value={id}>{b.label}</option>)}{!binding && selectedStack !== 'overview' && <option value={selectedStack}>{definition?.name}</option>}</select></label>
      <nav className="sx-operating-views" aria-label="Measured views">
        <button type="button" className="sx-overview-link" aria-pressed={selectedStack === 'overview'} onClick={() => change({ stack: null, source: null, make: null, model: null, vehicleYear: null, group: null })}>Corpus overview →</button>
        {Object.entries(bindings).map(([id,b]) => <button type="button" key={id} className="sx-question" aria-pressed={selectedStack === id} onClick={() => chooseStack(id)}><strong>{b.label}</strong><span aria-hidden="true">→</span></button>)}
      </nav>
      <details className="sx-catalog"><summary>All {catalog.length} stack definitions</summary>
        <label className="sx-search"><input aria-label="Find a stack question" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Bidders, liquidity, condition…" /></label>
        <div className="sx-catalog-scroll">{Object.entries(familyNames).map(([family, label]) => {
          const rows = filtered.filter(c => c.family === family); if (!rows.length) return null;
          return <details key={family} className="sx-family" open={search ? true : undefined}><summary>{label}<small>{rows.length}</small></summary>{rows.map(c => <button type="button" key={c.id} className="sx-definition-row" aria-pressed={selectedStack === c.id} onClick={() => chooseStack(c.id)}><span>{c.id}</span>{c.name}</button>)}</details>;
        })}</div>
        {!filtered.length && <p className="sx-chart-note">No definition matches this search.</p>}
      </details>
    </aside><div className="sx-workbench">
      {selectedStack === 'overview' ? <>{study.isPending && <div className="sx-loading" role="status">Reading the captured population…</div>}{study.isError && <p className="sx-state" role="status">The retained study could not be loaded. <button type="button" onClick={() => void study.refetch()}>Try again</button></p>}{study.data && <StackExploreOverview dataset={study.data} onOpen={(id,scope) => { const b = bindings[id]; change({ stack:id, by:b.grouping, measure:b.measure, from:'2016', to:String(new Date().getUTCFullYear()), make:null, model:null, vehicleYear:null, source:null, group:null, weight:null, paired:null, ...scope }); }} />}</> : !binding ? <DefinitionView id={selectedStack} change={change} /> : <>
        <div className="sx-kicker">{selectedStack} / {binding.label} / Descriptive measurements</div>
        <h2>{expression.grouping === 'year' ? 'How has bidding changed over time?' : expression.grouping === 'participant' ? (expression.measure === 'winRate' ? 'Who turns participation into wins?' : 'How differently do the participants bid?') : 'How differently do these markets bid?'}</h2>
        <div className="sx-breadcrumb"><button type="button" onClick={() => change({ make: null, model: null, vehicleYear:null, by: 'make', group: null, source: null })}>All sampled makes</button>{expression.make && <><span>›</span><button type="button" onClick={() => change({ model: null, vehicleYear: null, by: 'model', group: null })}><MakeLogo make={expression.make} />{expression.make}</button></>}{expression.model && <><span>›</span><strong>{expression.model}</strong></>}</div>
        <div className="sx-expression" aria-label="Measurement expression"><label>Measure<select value={expression.measure} onChange={e => change({ measure: e.target.value, group: null })}>{Object.entries(measures).filter(([m]) => !(expression.grouping === 'participant' && m === 'participants') && !(expression.grouping !== 'participant' && ['winRate','entry'].includes(m))).map(([m, label]) => <option value={m} key={m}>{label.label}</option>)}</select></label><label>Group by<select value={expression.grouping} onChange={e => change({ by: e.target.value, group: null, ...(e.target.value === 'participant' && expression.measure === 'participants' ? { measure: 'bids' } : e.target.value !== 'participant' && ['winRate','entry'].includes(expression.measure) ? { measure:'typical' } : {}) })}>{Object.entries(groupNames).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label><label>Bid year from<select value={expression.from} onChange={e => change({ from: e.target.value, to: String(Math.max(Number(e.target.value), expression.to)), group: null })}>{years.map(y => <option key={y}>{y}</option>)}</select></label><label>To<select value={expression.to} onChange={e => change({ to: e.target.value, from: String(Math.min(expression.from, Number(e.target.value))), group: null })}>{years.map(y => <option key={y}>{y}</option>)}</select></label>{['amount', 'increment', 'relative'].includes(expression.measure) && <label>Weighting<select value={expression.weighting} disabled={!['amount', 'increment', 'relative'].includes(expression.measure)} onChange={e => change({ weight: e.target.value, group: null })}><option value="auction">Each record equally</option><option value="bid">Each bid / raise equally</option></select></label>}</div>
        <details className="sx-scope"><summary>Change vehicle scope <span>{[expression.make,expression.model,expression.vehicleYear].filter(Boolean).join(' / ') || 'All sampled vehicles'}</span></summary><div className="sx-filters"><label>Make<select value={expression.make ?? ''} onChange={e => change({ make: e.target.value || null, model: null, vehicleYear: null, group: null, source: null })}><option value="">All sampled makes</option>{makeOptions.map(m => <option key={m}>{m}</option>)}</select></label><label>Model label<select value={expression.model ?? ''} onChange={e => change({ model: e.target.value || null, vehicleYear: null, group: null })}><option value="">All model labels</option>{modelOptions.map(m => <option key={m}>{m}</option>)}</select></label>{expression.make && <label>Vehicle model year<select value={expression.vehicleYear ?? ''} onChange={e => change({ vehicleYear:e.target.value || null, group:null })}><option value="">All vehicle years</option>{vehicleYears.map(y => <option key={y}>{y}</option>)}</select></label>}<button type="button" className="sx-read-button" disabled={read.isFetching} onClick={() => { if (request) void read.refetch(); else change({ source: 'read', from: String(expression.to), group: null }); }}>{read.isFetching ? 'Reading…' : `Read current ${expression.make ?? 'BaT'} · ${expression.to}`}</button>{request && <button type="button" className="sx-text-button" onClick={() => change({ source: null, group: null })}>Return to retained study</button>}</div></details>
        {activeQuery.isPending && <div className="sx-loading" role="status">Reading the selected population…</div>}
        {activeQuery.isError && <div className="sx-state" role="status">The selected evidence could not be read{dataset ? '; the previous completed reading is retained below' : '; no measurement is substituted'}. <button type="button" onClick={() => void activeQuery.refetch()}>Try again</button></div>}
        {result && dataset && <>
          <div className="sx-measure-heading"><h3>{measures[expression.measure].label} by {groupNames[expression.grouping].toLowerCase()}</h3><span>{expression.measure === 'winRate' ? `${result.rankValues.length} ranked participants · ≥5 attributed outcomes each` : `${result.contributingLots.toLocaleString()} auctions · ${result.values.length.toLocaleString()} records`}</span></div>
          <p className="sx-selection-note">{measures[expression.measure].unit} · {request ? `Bounded recent-first ${expression.to} read` : 'Retained quarter sample'} · {paired && 'paired entry/outcome records · '} {expression.weighting === 'bid' && ['amount', 'increment', 'relative'].includes(expression.measure) ? 'bid / raise weighted' : 'equal record weight'}{paired && <> · <button type="button" className="sx-text-button" onClick={() => change({paired:null})}>All captured outcomes</button></>}</p>
          {expression.grouping === 'year' ? <CalendarPlot result={result} onSelect={pick} selected={selectedGroup?.key ?? null} /> : <DistributionPlot dataset={dataset} query={params.toString()} onClose={() => change({group:null})} key={[expression.measure,expression.grouping,expression.make,expression.model,expression.vehicleYear,expression.from,expression.to].join(':')} result={result} onSelect={pick} selected={selectedGroup?.key ?? null} />}
          {selectedGroup && expression.grouping === 'year' && <ContributorInspection dataset={dataset} result={result} group={selectedGroup} query={params.toString()} />}
          <details className="sx-method"><summary>Measurement, population & evidence receipt <span>{result.bidN.toLocaleString()} bids / {result.raiseN.toLocaleString()} valid raises</span></summary><div className="sx-method-body"><p>{binding.boundary}</p><p><strong>{definition?.name}.</strong> {definition?.question}</p><pre>{`Δᵢ = bidᵢ − preceding valid standing bid\nRelative raise = 100 × Δᵢ / preceding bid\nMean = sum / valid observation count\nBid-weighted mean = sum of member sums / sum of member counts\nEqual-record mean = mean of member measurements\nP = empirical midrank of the mean among selected records (participant means for participant views)`}</pre><p>Typical relative raise is the median of valid bid-level relative raises inside each record, then the mean of those medians within a group. This reduces the influence of very small opening bids; it does not adjust for vehicle condition or estimate bidder skill. Opening bids have no increment. Increments and spacing are formed inside complete episodes before selecting the later bid’s calendar year. Dollars are source-listed nominal USD. Relative increments can be sensitive to small opening amounts. The interval shown is the middle half of observed record values, not uncertainty around the mean.</p><p>{dataset.selection} {dataset.capped ? 'Candidate selection reached its retrieval cap.' : ''} This is not a market census or a representative market estimate. Counts and changes can reflect capture, exclusions and vehicle/participant mix. Current-year data is partial.</p><p>Model groups use the current normalized model label when present, otherwise the source label ({result.modelFallbackLots} scoped auctions). They do not establish common generation, condition or configuration. Entry timing is the first placement’s elapsed share of the completed, observed first-to-terminal bidding span. This is not the official auction opening window or an as-of forecast feature. Participant comparisons describe canonical participant × auction records held now. Win conversion uses only outcomes whose winner key agrees with the terminal bidder key, and participant percentile ranks require at least five such outcomes. {dataset.lots.filter(l => l.winnerConflict).length} captured episodes have conflicting winner keys and are withheld from win conversion. Crossing-year episodes are withheld from participant views when any part of the episode is outside the selected year window.</p><p>{dataset.knowledgeMode} Dataset read {new Date(dataset.readAt).toLocaleString()}. Method {result.method}. {dataset.lots.length} eligible / {dataset.candidateN} selected auctions; {dataset.exclusions.length} excluded. {result.withheldRecordN} missing/withheld measurement records in this selection.</p><table><thead><tr><th>Recorded close year</th><th>Candidates</th><th>Eligible episodes</th><th>Excluded</th></tr></thead><tbody>{Object.entries(dataset.candidatesByYear).map(([year, n]) => <tr key={year}><td>{year}</td><td>{n}</td><td>{dataset.lots.filter(l => l.end.startsWith(year)).length}</td><td>{dataset.exclusions.filter(e => String(e.year) === year).length}</td></tr>)}</tbody></table><details><summary>Exclusion reasons</summary><ul>{Object.entries(dataset.exclusions.reduce<Record<string, number>>((a, e) => { a[e.reason] = (a[e.reason] ?? 0) + 1; return a; }, {})).map(([reason, n]) => <li key={reason}>{n} · {reason}</li>)}</ul></details></div></details>
        </>}
      </>}
    </div></div>
    <details className="sx-logo-credits"><summary>Logo credits</summary><p>Porsche crest: <a href="https://commons.wikimedia.org/wiki/File:Newporschecrest.jpg">Martin M.B.</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, Commons thumbnail. <a href="/stacks/makes/SOURCES.md">All logo sources</a>.</p></details>
  </main>;
}
