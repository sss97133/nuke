/**
 * VehicleBriefing — L0 intelligence headline + L1 signal summary.
 *
 * The first intelligence a user sees after the hero image. Synthesizes:
 * - Analysis signals (highest severity → headline)
 * - Nuke estimate + comps (market position)
 * - Comment sentiment (community pulse)
 * - Apparition count (listing history)
 * - Observation/evidence depth (trust assessment)
 *
 * Self-guarding: returns null if no meaningful intelligence exists.
 * Design: see docs/library/technical/design-book/11-intelligence-surface.md
 * Philosophy: see docs/library/intellectual/discourses/the-knowing-system.md
 */
import React, { useState } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import type { VehicleIntel, CommentIntel, Apparition, CompSale } from './hooks/useVehicleIntel';

// ---------------------------------------------------------------------------
// Design tokens — matches vehicle-profile.css system
// ---------------------------------------------------------------------------

const LABEL: React.CSSProperties = {
  fontFamily: 'var(--vp-font-sans, Arial, sans-serif)',
  fontSize: '7px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--vp-pencil, #999)',
};

const MONO: React.CSSProperties = {
  fontFamily: 'var(--vp-font-mono, "Courier New", monospace)',
  fontSize: '9px',
};

// ---------------------------------------------------------------------------
// Headline generation — the single most important sentence
// ---------------------------------------------------------------------------

interface HeadlineResult {
  text: string;
  severity: 'critical' | 'warning' | 'info' | 'ok' | 'neutral';
}

function generateHeadline(
  vehicle: any,
  intel: VehicleIntel | null,
  observationCount: number,
): HeadlineResult | null {
  // Priority 1: HIGH-severity red flags only (real warnings, not trivia)
  const flags = intel?.description_intel?.red_flags;
  const highFlags = flags?.filter(f => f.sev?.toLowerCase() === 'high');
  if (highFlags && highFlags.length > 0) {
    return { text: highFlags[0].f, severity: 'warning' };
  }

  // Priority 2: Community concerns — only headline when overall sentiment is NOT positive
  // (minor concerns in an otherwise positive discussion aren't the top-line story)
  const concerns = intel?.comment_intel?.community_concerns;
  const overallSentiment = (intel?.comment_intel?.overall_sentiment || '').toLowerCase();
  const sentimentIsPositive = overallSentiment.includes('positive') || overallSentiment.includes('enthusiastic');
  if (concerns && concerns.length > 0 && !sentimentIsPositive) {
    const concern = typeof concerns[0] === 'string' ? concerns[0] : (concerns[0] as any).concern || '';
    if (concern) return { text: concern, severity: 'warning' };
  }

  // Priority 3: Market position (estimate vs asking)
  // Only compare when both values are in the same ballpark (within 5x of each other)
  // to avoid nonsense like "$310 sale price vs $27K estimate" where $310 is a BaT bid, not asking
  const estimate = vehicle?.nuke_estimate;
  const asking = vehicle?.asking_price || vehicle?.price;
  if (estimate && asking && estimate > 0 && asking > 0) {
    const ratio = Math.max(estimate, asking) / Math.min(estimate, asking);
    if (ratio < 5) {
      const diff = ((estimate - asking) / asking) * 100;
      const fmt = (n: number) => '$' + Math.round(n).toLocaleString();
      if (diff > 15) {
        return { text: `Priced ${Math.round(diff)}% below estimated value (${fmt(estimate)})`, severity: 'ok' };
      }
      if (diff < -15) {
        return { text: `Priced ${Math.round(Math.abs(diff))}% above estimated value (${fmt(estimate)})`, severity: 'info' };
      }
    }
  }

  // Priority 4: Community sentiment (positive or negative — both are signal)
  const sentiment = intel?.comment_intel;
  if (sentiment?.overall_sentiment && sentiment.comment_count && sentiment.comment_count > 10) {
    const s = sentiment.overall_sentiment.toLowerCase();
    if (s.includes('positive') || s.includes('enthusiastic')) {
      return {
        text: `${sentiment.comment_count} comments analyzed — community sentiment is ${sentiment.overall_sentiment.toLowerCase()}`,
        severity: 'ok',
      };
    }
    if (s.includes('negative') || s.includes('critical')) {
      return {
        text: `${sentiment.comment_count} comments analyzed — community sentiment is ${sentiment.overall_sentiment.toLowerCase()}`,
        severity: 'warning',
      };
    }
  }

  // Priority 5: Lower-severity red flags (informational, not alarming)
  if (flags && flags.length > 0) {
    return { text: flags[0].f, severity: 'info' };
  }

  // Priority 6: Strong documentation
  if (observationCount >= 10) {
    return {
      text: `${observationCount} observations tracked across the system`,
      severity: 'neutral',
    };
  }

  // Priority 6: Estimate available
  if (estimate && estimate > 0) {
    const fmt = (n: number) => '$' + Math.round(n).toLocaleString();
    return {
      text: `Estimated value: ${fmt(estimate)}`,
      severity: 'neutral',
    };
  }

  // Nothing meaningful to say
  return null;
}

const SEVERITY_BG: Record<string, string> = {
  critical: 'var(--error-dim)',
  warning: 'var(--warning-dim)',
  info: 'var(--info-dim)',
  ok: 'var(--success-dim)',
  neutral: 'var(--surface-elevated, #F3F4F6)',
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'var(--error)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  ok: 'var(--success)',
  neutral: 'var(--border)',
};

// ---------------------------------------------------------------------------
// Stat pills — compact metrics row
// ---------------------------------------------------------------------------

interface StatPillProps {
  label: string;
  value: string;
  accent?: string;
}

const StatPill: React.FC<StatPillProps> = ({ label, value, accent }) => (
  <div style={{
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: '4px',
    padding: '2px 6px',
    border: '1px solid var(--border, #E5E7EB)',
  }}>
    <span style={LABEL}>{label}</span>
    <span style={{ ...MONO, fontWeight: 700, color: accent || 'var(--text, #000)' }}>{value}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Comp row — mini comparable sale
// ---------------------------------------------------------------------------

const CompRow: React.FC<{ comp: CompSale }> = ({ comp }) => {
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString();
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '32px 1fr auto auto',
      gap: '6px',
      alignItems: 'center',
      padding: '3px 0',
      borderBottom: '1px solid var(--border, #eee)',
      ...MONO,
    }}>
      {comp.thumbnail ? (
        <img src={comp.thumbnail} alt="" style={{ width: 32, height: 24, objectFit: 'cover' }} />
      ) : (
        <div style={{ width: 32, height: 24, background: 'var(--surface-elevated, #f5f5f5)' }} />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {comp.year ? `'${String(comp.year).slice(2)} ` : ''}{comp.model || '—'}
      </span>
      <span style={{ fontWeight: 700, color: 'var(--vp-sold, #000)' }}>{fmt(comp.sale_price)}</span>
      <span style={{ color: 'var(--text-secondary, #999)', fontSize: '8px' }}>
        {comp.sale_date ? new Date(comp.sale_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : ''}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const VehicleBriefing: React.FC = () => {
  const { vehicle, vehicleIntel, vehicleIntelLoading, observationCount } = useVehicleProfile();
  const [showComps, setShowComps] = useState(false);

  if (!vehicle || vehicleIntelLoading) return null;

  const headline = generateHeadline(vehicle, vehicleIntel, observationCount);
  const estimate = vehicle.nuke_estimate;
  const scores = vehicleIntel?.scores;
  const comps = vehicleIntel?.recent_comps;
  const apparitions = vehicleIntel?.apparitions;
  const sentiment = vehicleIntel?.comment_intel;

  // Compute stat pills
  const pills: StatPillProps[] = [];

  if (estimate && estimate > 0) {
    pills.push({
      label: 'ESTIMATE',
      value: '$' + Math.round(estimate).toLocaleString(),
    });
  }

  if (scores?.deal_score != null && scores.deal_score !== 0) {
    const ds = scores.deal_score;
    const label = ds > 50 ? 'GOOD DEAL' : ds > 0 ? 'FAIR' : 'ABOVE MKT';
    const accent = ds > 50 ? 'var(--vp-brg, #004225)' : ds > 0 ? 'var(--text)' : 'var(--vp-danger, #d13438)';
    pills.push({ label: 'DEAL', value: label, accent });
  }

  if (scores?.heat_score != null && scores.heat_score > 0) {
    pills.push({ label: 'HEAT', value: String(scores.heat_score) });
  }

  if (sentiment?.comment_count && sentiment.comment_count > 0) {
    const sentLabel = sentiment.sentiment_score != null
      ? `${sentiment.sentiment_score > 0.6 ? '+' : ''}${(sentiment.sentiment_score * 100).toFixed(0)}%`
      : String(sentiment.comment_count);
    pills.push({ label: 'COMMUNITY', value: `${sentiment.comment_count} comments` });
  }

  if (apparitions && apparitions.length > 1) {
    pills.push({ label: 'HISTORY', value: `${apparitions.length} appearances` });
  }

  if (observationCount > 0) {
    pills.push({ label: 'OBSERVATIONS', value: String(observationCount) });
  }

  // Self-guard: nothing to show
  if (!headline && pills.length === 0) return null;

  return (
    <div style={{ margin: '0 12px 8px' }}>
      {/* L0: Headline */}
      {headline && (
        <div style={{
          padding: '6px 10px',
          background: SEVERITY_BG[headline.severity] || SEVERITY_BG.neutral,
          borderLeft: `3px solid ${SEVERITY_BORDER[headline.severity] || SEVERITY_BORDER.neutral}`,
          fontFamily: 'var(--vp-font-sans, Arial, sans-serif)',
          fontSize: '9px',
          lineHeight: '1.5',
          color: 'var(--text, #000)',
          marginBottom: '6px',
        }}>
          {headline.text}
        </div>
      )}

      {/* L1: Stat pills */}
      {pills.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: comps && comps.length > 0 ? '6px' : 0 }}>
          {pills.map((p, i) => <StatPill key={i} {...p} />)}
        </div>
      )}

      {/* Expandable comps preview */}
      {comps && comps.length > 0 && (
        <div>
          <button
            onClick={() => setShowComps(!showComps)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 0',
              fontFamily: 'var(--vp-font-sans, Arial, sans-serif)',
              fontSize: '8px',
              color: 'var(--text-secondary, #666)',
              letterSpacing: '0.05em',
            }}
          >
            {showComps ? '▲ HIDE' : '▼ VIEW'} {comps.length} COMPARABLE SALE{comps.length !== 1 ? 'S' : ''}
          </button>
          {showComps && (
            <div style={{ marginTop: '4px' }}>
              {comps.slice(0, 5).map((comp, i) => (
                <CompRow key={comp.id || i} comp={comp} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VehicleBriefing;
