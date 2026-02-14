import React from 'react';
import MicroPortal from './MicroPortal';
import { computeVehicleCompleteness, type FieldImportance, type VehicleCompleteness } from '../../../hooks/useVehicleCompleteness';

/**
 * CompletenessPortal — click the % bar to see field-by-field breakdown.
 *
 * Green checks for filled, amber/red for missing, grouped by importance.
 * Each missing field has an action button when available.
 * Always rendered — never truly "empty".
 */

interface CompletenessPortalProps {
  vehicle: Record<string, any>;
  activePortal: string | null;
  onOpen: (id: string | null) => void;
}

const IMPORTANCE_LABELS: Record<FieldImportance, string> = {
  critical: 'Critical',
  important: 'Important',
  nice_to_have: 'Nice to Have',
};

const IMPORTANCE_COLORS: Record<FieldImportance, string> = {
  critical: '#ef4444',
  important: '#f59e0b',
  nice_to_have: '#6b7280',
};

export default function CompletenessPortal({ vehicle, activePortal, onOpen }: CompletenessPortalProps) {
  const completeness = computeVehicleCompleteness(vehicle);

  const trigger = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span style={{
        width: '40px',
        height: '4px',
        background: 'var(--border)',
        borderRadius: '2px',
        overflow: 'hidden',
        display: 'inline-block',
      }}>
        <span style={{
          display: 'block',
          width: `${completeness.percent}%`,
          height: '100%',
          background: completeness.percent > 70 ? '#22c55e' : completeness.percent > 40 ? '#f59e0b' : '#ef4444',
        }} />
      </span>
      <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>{completeness.percent}%</span>
    </span>
  );

  return (
    <MicroPortal
      portalId="completeness"
      activePortal={activePortal}
      onOpen={onOpen}
      trigger={trigger}
      width={260}
    >
      <div style={{ padding: '10px 12px' }}>
        <div style={{
          fontSize: '7pt',
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '8px',
        }}>
          Data Completeness — {completeness.filledCount}/{completeness.totalCount}
        </div>

        {/* Summary bar */}
        <div style={{
          display: 'flex',
          gap: '2px',
          height: '6px',
          borderRadius: '3px',
          overflow: 'hidden',
          marginBottom: '10px',
        }}>
          {completeness.fields.map((f) => (
            <div
              key={f.key}
              style={{
                flex: 1,
                background: f.filled
                  ? '#22c55e'
                  : f.importance === 'critical' ? '#ef4444'
                  : f.importance === 'important' ? '#f59e0b'
                  : '#d1d5db',
                transition: 'background 0.2s',
              }}
              title={`${f.label}: ${f.filled ? 'filled' : 'missing'}`}
            />
          ))}
        </div>

        {/* Grouped fields */}
        {(['critical', 'important', 'nice_to_have'] as FieldImportance[]).map((importance) => {
          const group = completeness.fields.filter(f => f.importance === importance);
          const summary = completeness.byImportance[importance];
          return (
            <div key={importance} style={{ marginBottom: '8px' }}>
              <div style={{
                fontSize: '7pt',
                fontWeight: 600,
                color: IMPORTANCE_COLORS[importance],
                marginBottom: '3px',
              }}>
                {IMPORTANCE_LABELS[importance]} ({summary.filled}/{summary.total})
              </div>
              {group.map((f) => (
                <div
                  key={f.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '2px 0',
                    fontSize: '8pt',
                  }}
                >
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: f.filled ? 'var(--text)' : 'var(--text-muted)',
                  }}>
                    <span style={{
                      fontSize: '9pt',
                      lineHeight: 1,
                      width: '14px',
                      textAlign: 'center',
                    }}>
                      {f.filled ? '\u2713' : '\u2013'}
                    </span>
                    {f.label}
                  </span>
                  {!f.filled && f.action && (
                    <span
                      style={{
                        fontSize: '7pt',
                        color: 'var(--primary, #3b82f6)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {f.action}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </MicroPortal>
  );
}
