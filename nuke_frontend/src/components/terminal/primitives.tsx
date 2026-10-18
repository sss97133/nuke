/**
 * Terminal primitives — the shared pieces of the "Bloomberg-for-a-cohort" idiom.
 *
 * Extracted from pages/CohortTerminal.tsx so the cohort terminal and the deal
 * read render the same panel, the same section header and the same honest
 * DARK state. Design per docs/library/technical/design-book: 2px solid panel
 * borders, zero radius, zero shadow, Arial labels at 8–9px, Courier New for
 * machine data, colour only when it carries data.
 */

import React from 'react';
import { panelStyle } from './styles';

export function SectionHeader({ label, meta }: { label: string; meta?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: '8px', marginBottom: '8px',
    }}>
      <div style={{
        fontSize: 'var(--fs-9)', fontWeight: 800, letterSpacing: '1px',
        textTransform: 'uppercase', color: 'var(--text)',
      }}>
        {label}
      </div>
      {meta != null && meta !== '' && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-9)',
          color: 'var(--text-secondary)', textAlign: 'right',
        }}>
          {meta}
        </div>
      )}
    </div>
  );
}

// Honest DARK state — an intake gap, NOT a market verdict, NOT a fake value.
// Dashed 2px border + a hollow square (the "no signal yet" mark) reads as
// "reserved slot, not yet recorded" — deliberate, never broken or empty.
export function DarkBlock({ label, reason, meta = 'INTAKE GAP', children }: {
  label: string; reason: React.ReactNode; meta?: string; children?: React.ReactNode;
}) {
  return (
    <div style={{ ...panelStyle, borderStyle: 'dashed', background: 'var(--bg)' }}>
      <SectionHeader label={label} meta={meta} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{
          flexShrink: 0, width: '8px', height: '8px', marginTop: '2px',
          border: '1px solid var(--text-secondary)',
        }} />
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-10)',
          color: 'var(--text-secondary)', lineHeight: 1.5,
        }}>
          {reason}
        </div>
      </div>
      {children}
    </div>
  );
}
