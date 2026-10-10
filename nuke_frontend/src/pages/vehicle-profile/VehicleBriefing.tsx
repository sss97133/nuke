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
import React, { useState, useEffect } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import { supabase } from '../../lib/supabase';
import SoldContext from './SoldContext';
import type { VehicleIntel } from './hooks/useVehicleIntel';
import { useVehiclePriceFacts, priceKindLabel, type PriceFacts } from './hooks/useVehiclePriceFacts';

// ---------------------------------------------------------------------------
// Stored appraisal (vehicle_condition_scores). Its range is a reported output;
// this reader does not expose contributing inputs or calibration evidence.
// ---------------------------------------------------------------------------

interface EyeRead {
  band: [number, number] | null;
  conditionClass: string | null;
  tier: string;
  score: number;
  reportedInputCount: number | null;
  method: string;
  computedAt: string | null;
}

function useEyeRead(vehicleId: string | undefined): EyeRead | null {
  const [read, setRead] = useState<EyeRead | null>(null);
  useEffect(() => {
    if (!vehicleId) return;
    let alive = true;
    supabase
      .from('vehicle_condition_scores')
      .select('condition_score, condition_tier, descriptor_summary, observation_count, computed_at, computation_version')
      .eq('vehicle_id', vehicleId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        const ds: any = data.descriptor_summary || {};
        const band = Array.isArray(ds.as_is_band_usd) && ds.as_is_band_usd[0] != null
          ? [Number(ds.as_is_band_usd[0]), Number(ds.as_is_band_usd[1])] as [number, number]
          : null;
        setRead({
          band,
          conditionClass: typeof ds.condition_class === 'string' ? ds.condition_class.split('(')[0].trim() : null,
          tier: data.condition_tier,
          score: Number(data.condition_score),
          reportedInputCount: data.observation_count,
          method: data.computation_version || 'appraisal',
          computedAt: data.computed_at,
        });
      });
    return () => { alive = false; };
  }, [vehicleId]);
  return read;
}

// ---------------------------------------------------------------------------
// Market event: what a model estimate or a deal verdict is defended against
// (owner rule: never show a price you can't defend). The typed price says which exists:
// - a price: a proven sale, a bid or a current ask (price_kind sold / bid / ask);
// - a listing with no price yet: a live or upcoming auction, or a for-sale listing
//   (outcome active / for_sale).
// The estimate needs either one; the deal verdict needs a price. A car that isn't
// listed, such as an owner's build, has neither, so it shows no estimate and no
// verdict. sale_status alone can't tell: 'available' is also carried by unlisted cars.
// ---------------------------------------------------------------------------

function marketDefends(p: PriceFacts | null): { estimate: boolean; deal: boolean } {
  const priced = priceKindLabel(p) !== null;
  const listed = p?.outcome === 'active' || p?.outcome === 'for_sale';
  return { estimate: priced || listed, deal: priced };
}

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
  priceFacts: PriceFacts | null = null,
): HeadlineResult | null {
  // Priority 0: preserve the stored range without making an unqualified deal verdict.
  if (eyeRead?.band) {
    const [lo, hi] = eyeRead.band;
    const fmt = (n: number) => '$' + Math.round(n / 100) / 10 + 'k';
    const cls = eyeRead.conditionClass ? ` · reported condition: ${eyeRead.conditionClass}` : '';
    return { text: `Stored appraisal range: ${fmt(lo)}–${fmt(hi)} USD${cls}`, severity: 'info' };
  }
  // Priority 1: HIGH-severity red flags only (real warnings, not trivia)
  const flags = intel?.description_intel?.red_flags;
  const highFlags = flags?.filter(f => f.sev?.toLowerCase() === 'high');
  if (highFlags && highFlags.length > 0) {
    return { text: highFlags[0].f, severity: 'warning' };
  }

  // Priority 2: Reported concerns. The stored summary does not verify source membership
  // or establish that a positive overall label resolves an individual concern.
  const concerns = intel?.comment_intel?.community_concerns;
  if (concerns && concerns.length > 0) {
    const concern = typeof concerns[0] === 'string' ? concerns[0] : (concerns[0] as any).concern || '';
    if (concern) return { text: `Reported comment concern (source unverified): ${concern}`, severity: 'info' };
  }

  // Priority 3: Market position (estimate vs asking)
  // Only compare when both values are in the same ballpark (within 5x of each other)
  // to avoid nonsense like "$310 sale price vs $27K estimate" where $310 is a BaT bid, not asking
  const estimate = vehicle?.nuke_estimate;
  // only a current ask is "priced at"; a sold car's old asking_price is not
  const asking = priceFacts?.price_kind === 'ask' ? priceFacts.price_amount : null;
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

  // Priority 4: A reported interpretation; retrieved count is not prompt inclusion proof.
  const sentiment = intel?.comment_intel;
  if (sentiment?.overall_sentiment) {
    return {
      text: `Reported comment summary: ${sentiment.overall_sentiment.toLowerCase()} · input sample, method and analysis time unavailable`,
      severity: 'info',
    };
  }

  // Priority 5: Lower-severity red flags (informational, not alarming)
  if (flags && flags.length > 0) {
    return { text: flags[0].f, severity: 'info' };
  }

  // Priority 6: Estimate available, and a market event to defend it
  if (estimate && estimate > 0 && marketDefends(priceFacts).estimate) {
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
// Main component
// ---------------------------------------------------------------------------

const VehicleBriefing: React.FC<{ collapsed?: boolean }> = ({ collapsed = false }) => {
  const { vehicle, vehicleIntel, vehicleIntelLoading, observationCount } = useVehicleProfile();
  const eyeRead = useEyeRead(vehicle?.id);
  const { priceFacts, priceSettled } = useVehiclePriceFacts(vehicle?.id);

  if (!vehicle || vehicleIntelLoading || !priceSettled) return null;

  const headline = generateHeadline(vehicle, vehicleIntel, observationCount, eyeRead, priceFacts);
  const estimate = vehicle.nuke_estimate;
  const comps = vehicleIntel?.recent_comps;
  const sentiment = vehicleIntel?.comment_intel;
  const defended = marketDefends(priceFacts);

  // Compute stat pills
  const pills: StatPillProps[] = [];

  if (eyeRead?.band) {
    // Computation time is distinct from source capture and sale time.
    const [lo, hi] = eyeRead.band;
    pills.push({
      label: 'APPRAISAL',
      value: `$${Math.round(lo / 100) / 10}k–$${Math.round(hi / 100) / 10}k`,
    });
    const computed = eyeRead.computedAt ? new Date(eyeRead.computedAt) : null;
    pills.push({
      label: 'COMPUTED (UTC)',
      value: computed && Number.isFinite(computed.getTime())
        ? computed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        : 'Unknown',
    });
    pills.push({ label: 'INPUT COUNT', value: eyeRead.reportedInputCount != null ? `${eyeRead.reportedInputCount} reported` : 'Unknown' });
  } else if (estimate && estimate > 0 && defended.estimate) {
    // Legacy model estimate only when no evidence read exists — and labeled as such.
    pills.push({
      label: 'MODEL EST',
      value: '$' + Math.round(estimate).toLocaleString(),
    });
  }

  if (sentiment?.comment_count != null) {
    pills.push({ label: 'SUMMARY COUNT', value: `${sentiment.comment_count} reported` });
  }

  // Self-guard: nothing to show
  if (!headline && pills.length === 0 && !comps?.length) return null;

  const content = (
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

      {eyeRead?.band && (
        <div style={{ ...MONO, color: 'var(--text-secondary, #666)', marginTop: '4px', marginBottom: '4px' }}>
          Input IDs, count meaning and calibration unavailable. Condition matching unverified.
        </div>
      )}


    </div>
  );
  return <>
    {comps && <SoldContext comps={comps} scope={vehicleIntel?.recent_comps_scope} subject={vehicle} recordedSale={priceFacts?.price_kind === 'sold' ? priceFacts.price_amount : null} />}
    {(headline || pills.length > 0) && (collapsed ? <details className="vp-stored-interpretations"><summary>Stored model interpretations</summary>{content}</details> : content)}
  </>;
};

export default VehicleBriefing;
