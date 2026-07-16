import React from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { useWorthEngine } from './hooks/useWorthEngine';

const fmt = (n: number) =>
  '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const LABEL: React.CSSProperties = {
  fontSize: '8px',
  color: 'var(--vp-pencil)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight: 700,
};
const MONO: React.CSSProperties = {
  fontFamily: 'var(--vp-font-mono)',
  fontSize: '11px',
  fontWeight: 700,
};
const CELL: React.CSSProperties = {
  border: '2px solid var(--vp-border)',
  padding: '6px 8px',
};

const EXISTENCE_COPY: Record<string, string> = {
  zero: 'NO EVIDENCE',
  low: 'THIN EVIDENCE',
  moderate: 'MODERATE EVIDENCE',
  high: 'STRONG EVIDENCE',
};
const MAGNITUDE_COPY: Record<string, string> = {
  no_methods: 'NO METHODS',
  single_method: 'SINGLE METHOD · NO BRACKET',
  tight: 'TIGHT · <1.5×',
  bracketed: 'BRACKETED · 1.5–3×',
  wide_bracket: 'WIDE · >3×',
};

interface Props {
  vehicleId: string;
}

const WorthEngineCard: React.FC<Props> = ({ vehicleId }) => {
  const { data, isLoading, error } = useWorthEngine(vehicleId);

  if (isLoading) return null;
  if (error || !data || data.error) return null;
  if (data.substrate.images === 0 && data.substrate.atoms === 0) return null;

  const { inferred_value: iv, substrate, documented_costs: doc, existence_confidence, magnitude_confidence } = data;
  const low = iv.range_low_USD;
  const high = iv.range_high_USD;
  const widthPct = high > 0 ? Math.min(100, (low / high) * 100) : 0;

  return (
    <CollapsibleWidget variant="profile" title="Worth Engine — Labor Substrate" defaultCollapsed={false}>
      <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: 1.6 }}>
        {/* Top row: bracket bar */}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={LABEL}>BRACKETED LABOR VALUE (PHOTO SUBSTRATE)</span>
            <span style={{ ...MONO, fontSize: '8px' }}>
              {MAGNITUDE_COPY[magnitude_confidence] || magnitude_confidence}
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '2px',
              marginBottom: '4px',
            }}
          >
            <div style={CELL}>
              <div style={LABEL}>LOW (CONSERVATIVE / v3)</div>
              <div style={MONO}>{fmt(low)}</div>
            </div>
            <div style={CELL}>
              <div style={LABEL}>HIGH (OPTIMISTIC / v2)</div>
              <div style={MONO}>{fmt(high)}</div>
            </div>
          </div>
          <div
            style={{
              position: 'relative',
              height: '6px',
              border: '2px solid var(--vp-border)',
              background: 'var(--vp-bg-alt, #f0f0f0)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${widthPct}%`,
                background: 'var(--vp-ink)',
              }}
            />
          </div>
        </div>

        {/* Methods detail */}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ ...LABEL, marginBottom: '2px' }}>METHODS</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: '1px 8px',
              fontFamily: 'var(--vp-font-mono)',
              fontSize: '8px',
            }}
          >
            <span>v1 · work_session minutes × $160 × 0.92</span>
            <span style={{ textAlign: 'right' }}>{fmt(iv.v1_time_span_clamped_USD)}</span>
            <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>
              {iv.v1_independent ? 'independent' : iv.v1_available ? 'baseline_only' : 'unavailable'}
            </span>
            <span>v2 · images × 10min × $160 × 0.92</span>
            <span style={{ textAlign: 'right' }}>{fmt(iv.v2_photo_count_USD)}</span>
            <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>
              {iv.v2_available ? 'available' : 'unavailable'}
            </span>
            <span>v3 · burst-clustered active min × $160 × 0.92</span>
            <span style={{ textAlign: 'right' }}>{fmt(iv.v3_burst_active_USD)}</span>
            <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>
              {iv.v3_available ? 'available' : 'unavailable'}
            </span>
          </div>
          {iv.v2_v3_ratio > 0 && (
            <div style={{ ...LABEL, marginTop: '4px', fontWeight: 400 }}>
              v2/v3 RATIO · {iv.v2_v3_ratio.toFixed(2)}×
            </div>
          )}
        </div>

        {/* Substrate */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '2px',
            marginBottom: '10px',
          }}
        >
          <div style={CELL}>
            <div style={LABEL}>IMAGES</div>
            <div style={MONO}>{substrate.images.toLocaleString()}</div>
          </div>
          <div style={CELL}>
            <div style={LABEL}>ATOMS</div>
            <div style={MONO}>{substrate.atoms.toLocaleString()}</div>
          </div>
          <div style={CELL}>
            <div style={LABEL}>SESSIONS</div>
            <div style={MONO}>
              {substrate.work_sessions}
              {substrate.work_sessions_independent < substrate.work_sessions && (
                <span style={{ fontSize: '8px', color: 'var(--vp-pencil)', marginLeft: '4px' }}>
                  ({substrate.work_sessions_independent} indep)
                </span>
              )}
            </div>
          </div>
          <div style={CELL}>
            <div style={LABEL}>BURST MIN</div>
            <div style={MONO}>{substrate.burst_active_min.toLocaleString()}</div>
          </div>
        </div>

        {/* Documented costs (only if any) */}
        {doc.total_documented > 0 && (
          <div style={{ marginBottom: '10px' }}>
            <div style={{ ...LABEL, marginBottom: '2px' }}>DOCUMENTED COSTS (separate from labor inference)</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '1px 8px',
                fontFamily: 'var(--vp-font-mono)',
                fontSize: '8px',
              }}
            >
              <span>Parts (from work_sessions)</span>
              <span style={{ textAlign: 'right' }}>{fmt(doc.parts)}</span>
              <span>Payments out (payment_events)</span>
              <span style={{ textAlign: 'right' }}>{fmt(doc.payments_out)}</span>
            </div>
          </div>
        )}

        {/* Confidence row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '2px',
            marginBottom: '10px',
          }}
        >
          <div style={CELL}>
            <div style={LABEL}>EXISTENCE CONFIDENCE</div>
            <div style={{ ...MONO, fontSize: '9px' }}>
              {EXISTENCE_COPY[existence_confidence] || existence_confidence}
            </div>
          </div>
          <div style={CELL}>
            <div style={LABEL}>MAGNITUDE CONFIDENCE</div>
            <div style={{ ...MONO, fontSize: '9px' }}>
              {MAGNITUDE_COPY[magnitude_confidence] || magnitude_confidence}
            </div>
          </div>
        </div>

        {/* Open gaps */}
        {data.open_substrate_gaps && data.open_substrate_gaps.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ ...LABEL, marginBottom: '2px' }}>OPEN SUBSTRATE GAPS</div>
            <ul
              style={{
                margin: 0,
                paddingLeft: '14px',
                fontFamily: 'var(--vp-font-mono)',
                fontSize: '8px',
                color: 'var(--vp-pencil)',
              }}
            >
              {data.open_substrate_gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {data.warnings && data.warnings.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ ...LABEL, marginBottom: '2px' }}>WARNINGS</div>
            <ul
              style={{
                margin: 0,
                paddingLeft: '14px',
                fontFamily: 'var(--vp-font-mono)',
                fontSize: '8px',
              }}
            >
              {data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Methodology */}
        <div
          style={{
            ...LABEL,
            fontWeight: 400,
            borderTop: '2px solid var(--vp-border)',
            paddingTop: '6px',
            lineHeight: 1.5,
          }}
        >
          {data.methodology_note}
        </div>
      </div>
    </CollapsibleWidget>
  );
};

export default WorthEngineCard;
