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
import { usePopup } from '../../components/popups/usePopup';
import { freshnessOf, agoLabel } from './valueFreshness';
import { useEyeRead, type EyeRead } from './hooks/useEyeRead';
import type { VehicleIntel, CommentIntel, Apparition, CompSale } from './hooks/useVehicleIntel';

const EyeLedgerPopup = React.lazy(() => import('./EyeLedgerPopup'));

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
  eyeRead: EyeRead | null = null,
): HeadlineResult | null {
  // Priority 0: the Eye's evidence-graded read. When it exists, THE value story
  // is the band vs the real price — never the undefended model estimate.
  if (eyeRead?.band) {
    const [lo, hi] = eyeRead.band;
    const fmt = (n: number) => '$' + Math.round(n / 100) / 10 + 'k';
    const price = vehicle?.sale_price || vehicle?.sold_price || vehicle?.asking_price || vehicle?.price;
    const cls = eyeRead.conditionClass ? ` · ${eyeRead.conditionClass}` : '';
    if (price && price > 0) {
      const pos = price < lo ? `${fmt(price)} is BELOW the band`
        : price <= hi ? `${fmt(price)} is IN BAND`
        : `${fmt(price)} is ${fmt(price - hi)} above what the evidence proves`;
      return {
        text: `Evidence read: ${fmt(lo)}–${fmt(hi)} as-is${cls} — ${pos}`,
        severity: price <= hi ? 'ok' : 'warning',
      };
    }
    return { text: `Evidence read: ${fmt(lo)}–${fmt(hi)} as-is${cls}`, severity: 'info' };
  }
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
      // Percent is of the ESTIMATE (a price can never be >100% below a value).
      const diff = ((estimate - asking) / estimate) * 100;
      const fmt = (n: number) => '$' + Math.round(n).toLocaleString();
      if (diff > 15) {
        return { text: `Priced ${Math.round(diff)}% below model estimate (${fmt(estimate)})`, severity: 'ok' };
      }
      if (diff < -15) {
        return { text: `Priced ${Math.round(Math.abs(diff))}% above model estimate (${fmt(estimate)})`, severity: 'info' };
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
  // Staleness is structural: a comp's age decays its weight as evidence. Fade
  // and mark stale comps rather than showing them as if they were current.
  const fresh = freshnessOf(comp.sale_date);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '32px 1fr auto auto',
      gap: '6px',
      alignItems: 'center',
      padding: '3px 0',
      borderBottom: '1px solid var(--border, #eee)',
      opacity: fresh?.opacity ?? 1,
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
      <span style={{ fontSize: '8px', color: fresh && fresh.tier !== 'fresh' ? fresh.color : 'var(--text-secondary, #999)', whiteSpace: 'nowrap' }}>
        {comp.sale_date
          ? `${new Date(comp.sale_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}${fresh?.tier === 'stale' ? ' · STALE' : ''}`
          : 'undated'}
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
  const eyeRead = useEyeRead(vehicle?.id);
  const { openPopup } = usePopup();

  if (!vehicle || vehicleIntelLoading) return null;

  const headline = generateHeadline(vehicle, vehicleIntel, observationCount, eyeRead);
  // The Eye's headline drills to its ledger — the price is a button, per
  // drillable-ontology doctrine. Other headline sources have no drill target.
  const headlineIsEye = Boolean(eyeRead?.band);
  const drillPrice = vehicle?.sale_price || vehicle?.sold_price || vehicle?.asking_price || vehicle?.price;
  const openLedger = () => {
    if (!vehicle?.id || !eyeRead) return;
    openPopup(
      <React.Suspense fallback={<div style={{ padding: '12px', fontSize: '8px', fontFamily: 'var(--vp-font-sans, Arial, sans-serif)' }}>Opening the ledger…</div>}>
        <EyeLedgerPopup vehicleId={vehicle.id} eyeRead={eyeRead} price={drillPrice} />
      </React.Suspense>,
      'THE LEDGER',
      560,
      false,
    );
  };
  const estimate = vehicle.nuke_estimate;
  const scores = vehicleIntel?.scores;
  const comps = vehicleIntel?.recent_comps;
  const apparitions = vehicleIntel?.apparitions;
  const sentiment = vehicleIntel?.comment_intel;

  // Compute stat pills
  const pills: StatPillProps[] = [];

  if (eyeRead?.band) {
    // The Eye leads; carry the date so freshness is never a mystery.
    const [lo, hi] = eyeRead.band;
    pills.push({
      label: 'EYE READ',
      value: `$${Math.round(lo / 100) / 10}k–$${Math.round(hi / 100) / 10}k`,
    });
    // The read is a dated fact; carry its age and decay it visibly.
    const readFresh = freshnessOf(eyeRead.computedAt);
    pills.push({
      label: 'READ',
      value: `${new Date(eyeRead.computedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${agoLabel(eyeRead.computedAt)}`,
      accent: readFresh?.tier !== 'fresh' ? readFresh?.color : undefined,
    });
    if (eyeRead.frames) {
      pills.push({ label: 'FRAMES', value: String(eyeRead.frames) });
    }
  } else if (estimate && estimate > 0) {
    // Legacy model estimate only when no evidence read exists — and labeled as such.
    pills.push({
      label: 'MODEL EST',
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
      {/* L0: Headline — the Eye's headline is a button into the ledger */}
      {headline && (
        <div
          onClick={headlineIsEye ? openLedger : undefined}
          role={headlineIsEye ? 'button' : undefined}
          style={{
            padding: '6px 10px',
            background: SEVERITY_BG[headline.severity] || SEVERITY_BG.neutral,
            borderLeft: `3px solid ${SEVERITY_BORDER[headline.severity] || SEVERITY_BORDER.neutral}`,
            fontFamily: 'var(--vp-font-sans, Arial, sans-serif)',
            fontSize: '9px',
            lineHeight: '1.5',
            color: 'var(--text, #000)',
            marginBottom: '6px',
            cursor: headlineIsEye ? 'pointer' : undefined,
          }}
        >
          {headline.text}
          {headlineIsEye && (
            <span style={{
              float: 'right',
              fontSize: '8px',
              fontWeight: 700,
              letterSpacing: '0.05em',
              color: 'var(--text-secondary, #666)',
            }}>
              ▸ THE LEDGER
            </span>
          )}
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
            {(() => {
              const stale = comps.filter(c => freshnessOf(c.sale_date)?.tier === 'stale').length;
              return stale > 0 ? ` · ${stale} STALE` : '';
            })()}
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
