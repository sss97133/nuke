import { useId, useState, type ReactNode } from 'react';
import type { BidExpression, BidGrouping } from './bidMeasurements';

import { groupDefinitions, groupNames, groupingChange, measures } from './bidExpression';

export default function AnalyticalHeading({ expression, onChange, measureLabel, children }: {
  expression: BidExpression; onChange: (changes: Record<string, string | null>) => void; measureLabel?: string; children?: ReactNode;
}) {
  const [term, setTerm] = useState<'measure' | 'grouping' | null>(null), id = useId();
  const metric = measures[expression.measure];
  return <div className="sx-analysis-heading">
    <div className="sx-analysis-title"><h3 aria-label={`${measureLabel ?? metric.label} by ${groupNames[expression.grouping].toLowerCase()}`}>
      <button type="button" className="sx-term" aria-label={`Explain or change ${measureLabel ?? metric.label}`} aria-expanded={term === 'measure'} aria-controls={id} onClick={() => setTerm(term === 'measure' ? null : 'measure')}>{measureLabel ?? metric.label}</button>
      {' by '}<button type="button" className="sx-term" aria-label={`Explain or change ${groupNames[expression.grouping].toLowerCase()}`} aria-expanded={term === 'grouping'} aria-controls={id} onClick={() => setTerm(term === 'grouping' ? null : 'grouping')}>{groupNames[expression.grouping].toLowerCase()}</button>
    </h3>{children}</div>
    {term && <section id={id} className="sx-term-panel" aria-label={term === 'measure' ? 'Measurement definition and choices' : 'Grouping definition and choices'}>
      <div className="sx-term-panel-head"><strong>{term === 'measure' ? metric.label : groupNames[expression.grouping]}</strong><button type="button" className="sx-text-button" onClick={() => setTerm(null)}>Close definition</button></div>
      <p>{term === 'measure' ? metric.definition : groupDefinitions[expression.grouping]}</p>
      {term === 'measure' && <><pre>{metric.equation}</pre><p>{metric.unit} · {expression.weighting === 'bid' && ['amount','increment','relative'].includes(expression.measure) ? 'Each bid / raise equally weighted' : 'Each record equally weighted'}</p></>}
      {term === 'measure' ? <label>Replace measure<select value={expression.measure} onChange={e => {onChange({measure:e.target.value,group:null});setTerm(null);}}>{Object.entries(measures).filter(([m]) => !(expression.grouping === 'participant' && m === 'participants') && !(expression.grouping !== 'participant' && ['winRate','entry'].includes(m))).map(([m,v]) => <option key={m} value={m}>{v.label}</option>)}</select></label> : <label>Replace grouping<select value={expression.grouping} onChange={e => {onChange(groupingChange(expression,e.target.value as BidGrouping));setTerm(null);}}>{Object.entries(groupNames).map(([g,name]) => <option key={g} value={g}>{name}</option>)}</select></label>}
    </section>}
  </div>;
}
