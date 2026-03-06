// HarnessLoadSummary.tsx — Bottom bar showing total load, alternator/battery sizing, warnings

import React, { useMemo } from 'react';
import type { HarnessEndpoint, WiringConnection, HarnessSection } from './harnessTypes';
import { calculateLoadSummary } from './harnessCalculations';

interface Props {
  endpoints: HarnessEndpoint[];
  connections: WiringConnection[];
  sections: HarnessSection[];
  vehicleType: string | null;
}

export function HarnessLoadSummary({ endpoints, connections, sections, vehicleType }: Props) {
  const summary = useMemo(
    () => calculateLoadSummary(endpoints, connections, sections, vehicleType),
    [endpoints, connections, sections, vehicleType]
  );

  if (endpoints.length === 0) {
    return (
      <div style={{
        borderTop: '2px solid var(--border)',
        background: 'var(--surface)',
        padding: '4px 8px',
        fontSize: '9px',
        color: 'var(--text-muted)',
      }}>
        Add endpoints to see load calculations
      </div>
    );
  }

  return (
    <div style={{
      borderTop: '2px solid var(--border)',
      background: 'var(--surface)',
      padding: '4px 8px',
      fontSize: '9px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      flexWrap: 'wrap',
    }}>
      {/* Total amps */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
        <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '8px', color: 'var(--text-muted)' }}>TOTAL</span>
        <span style={{ fontFamily: '"Courier New", monospace', fontWeight: 700 }}>
          {summary.totalContinuousAmps}A
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '8px' }}>
          (peak {summary.totalPeakAmps}A)
        </span>
      </div>

      {/* Section breakdown */}
      {summary.perSection.filter(s => s.amps > 0).map(s => (
        <div key={s.sectionId} style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span style={{ fontSize: '8px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s.name}</span>
          <span style={{ fontFamily: '"Courier New", monospace', fontSize: '8px' }}>{s.amps}A</span>
        </div>
      ))}

      <div style={{ width: 1, height: 14, background: 'var(--border)' }} />

      {/* Alternator */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
        <span style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>ALT</span>
        <span style={{ fontFamily: '"Courier New", monospace' }}>{summary.alternatorSizing.recommended}</span>
      </div>

      {/* Battery */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
        <span style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>BATT</span>
        <span style={{ fontFamily: '"Courier New", monospace' }}>{summary.batterySizing.recommended}</span>
      </div>

      {/* PDM channel count */}
      {summary.pdmChannels.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>PDM</span>
          <span style={{ fontFamily: '"Courier New", monospace' }}>{summary.pdmChannels.length}/30 CH</span>
        </div>
      )}

      {/* Warnings */}
      {summary.warnings.length > 0 && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: 'var(--error)', fontWeight: 700, fontSize: '8px' }}>
            {summary.warnings.length} WARNING{summary.warnings.length > 1 ? 'S' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
