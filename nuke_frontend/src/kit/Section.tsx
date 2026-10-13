import React from 'react';
import type { Coverage, Measure } from './types';
import { Text } from './Text';
import { CoverageView, MeasureView } from './Measure';

/** A titled block with its denominator in the head. A section without coverage does not exist. */
export function Section({ title, coverage, children, ariaLabel }: { title: string; coverage: Coverage; children: React.ReactNode; ariaLabel?: string }) {
  return <section className="k-section" aria-label={ariaLabel ?? title}>
    <div className="k-section__head">
      <Text role="label" as="h2">{title}</Text>
      <CoverageView c={coverage} />
    </div>
    {children}
  </section>;
}

/** The identity row: entity on the left, its one headline result on the right. */
export function Masthead({ children, result }: { children: React.ReactNode; result?: React.ReactNode }) {
  return <header className="k-section k-masthead">
    {children}
    {result && <div className="k-masthead__result">{result}</div>}
  </header>;
}

/** A row of dimension members with its coverage at the end. */
export function Strip({ coverage, children, ariaLabel }: { coverage: Coverage; children: React.ReactNode; ariaLabel?: string }) {
  return <div className="k-section k-strip" role="group" aria-label={ariaLabel ?? 'Configuration'}>
    {children}
    <CoverageView c={coverage} className="k-strip__coverage" />
  </div>;
}

/** A dimension member on the strip. Opens whatever the caller passes for its drill. */
export function Facet({ label, expanded, onClick, ariaLabel }: { label: string; expanded: boolean; onClick: () => void; ariaLabel?: string }) {
  return <button type="button" className="k-facet" aria-haspopup="dialog" aria-expanded={expanded} aria-label={ariaLabel ?? label} onClick={onClick}>
    <Text role="label">{label}</Text>
  </button>;
}

/** Several measures from one stack, each with its own rank and coverage. */
export function Measures({ title, coverage, items, ariaLabel }: { title: string; coverage: Coverage; items: Measure[]; ariaLabel?: string }) {
  if (items.length === 0) return null;
  return <Section title={title} coverage={coverage} ariaLabel={ariaLabel}>
    <div className="k-measures">{items.map(item => <MeasureView key={item.label} m={item} />)}</div>
  </Section>;
}
