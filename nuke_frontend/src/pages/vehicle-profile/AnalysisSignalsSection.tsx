import React, { useState } from 'react';
import { useAnalysisSignals, type AnalysisSignal } from './hooks/useAnalysisSignals';
import { usePopup } from '../../components/popups/usePopup';

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'var(--error, #ef4444)',
  warning: 'var(--warning, #f59e0b)',
  info: 'var(--info, #3b82f6)',
  ok: 'var(--text-disabled, #999)',
};

const SignalDetailPopup: React.FC<{ signal: AnalysisSignal }> = ({ signal }) => (
  <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '9px', lineHeight: 1.6, padding: '8px' }}>
    <div style={{ fontWeight: 700, fontSize: '10px', marginBottom: '6px' }}>{signal.label}</div>
    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: '8px', fontWeight: 700,
        padding: '1px 5px', border: `2px solid ${SEVERITY_BORDER[signal.severity] || '#999'}`,
        color: SEVERITY_BORDER[signal.severity] || '#999', textTransform: 'uppercase',
      }}>{signal.severity}</span>
      {signal.score != null && (
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: '10px', fontWeight: 700 }}>
          {Math.round(signal.score)}/100
        </span>
      )}
      {signal.confidence != null && (
        <span style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
          {Math.round(signal.confidence * 100)}% confidence
        </span>
      )}
    </div>
    {signal.reasons?.length > 0 && (
      <>
        <div style={{ fontWeight: 700, fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px', color: 'var(--text-secondary)' }}>REASONS</div>
        <ul style={{ margin: '0 0 8px', paddingLeft: '14px' }}>
          {signal.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </>
    )}
    {signal.evidence && Object.keys(signal.evidence).length > 0 && (
      <>
        <div style={{ fontWeight: 700, fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px', color: 'var(--text-secondary)' }}>EVIDENCE</div>
        <pre style={{ fontFamily: "'Courier New', monospace", fontSize: '8px', whiteSpace: 'pre-wrap', margin: '0 0 8px', color: 'var(--text-secondary)' }}>
          {JSON.stringify(signal.evidence, null, 2)}
        </pre>
      </>
    )}
    {signal.recommendations && (
      <>
        <div style={{ fontWeight: 700, fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px', color: 'var(--text-secondary)' }}>RECOMMENDATIONS</div>
        <pre style={{ fontFamily: "'Courier New', monospace", fontSize: '8px', whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-secondary)' }}>
          {JSON.stringify(signal.recommendations, null, 2)}
        </pre>
      </>
    )}
  </div>
);

const AnalysisSignalsSection: React.FC<{ vehicleId: string }> = ({ vehicleId }) => {
  const { signals, loading } = useAnalysisSignals(vehicleId);
  const { openPopup } = usePopup();

  if (loading || signals.length === 0) return null;

  return (
    <div style={{
      background: 'var(--surface-elevated)',
      border: '2px solid var(--accent)',
      marginBottom: '8px',
    }}>
      <div style={{
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '1px',
        textTransform: 'uppercase',
        padding: '6px 10px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
      }}>
        SIGNALS
        <span style={{ marginLeft: '6px', fontWeight: 400, color: 'var(--text-disabled)' }}>{signals.length}</span>
      </div>
      {signals.map(signal => (
        <div
          key={signal.id}
          onClick={() => openPopup(
            <SignalDetailPopup signal={signal} />,
            `SIGNAL — ${signal.label}`,
            480,
            false,
          )}
          style={{
            display: 'grid',
            gridTemplateColumns: '4px 1fr auto',
            alignItems: 'center',
            gap: '0 8px',
            padding: '4px 10px',
            borderBottom: '1px solid var(--border)',
            cursor: 'pointer',
            fontSize: '9px',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          <div style={{
            width: '4px',
            alignSelf: 'stretch',
            background: SEVERITY_BORDER[signal.severity] || '#999',
          }} />
          <span style={{ color: 'var(--text)' }}>{signal.label}</span>
          <span style={{
            fontFamily: "'Courier New', monospace",
            fontSize: '8px',
            color: 'var(--text-secondary)',
          }}>
            {signal.score != null ? Math.round(signal.score) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
};

export default AnalysisSignalsSection;
