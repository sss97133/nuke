import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useVehicleProfile } from './VehicleProfileContext';

interface ArsData {
  vehicle_id: string;
  composite_score: number;
  tier: string;
  identity_score: number;
  photo_score: number;
  doc_score: number;
  desc_score: number;
  market_score: number;
  condition_score: number;
  coaching_plan: CoachingGap[] | null;
  photo_zones_present: string[];
  photo_zones_missing: string[];
  mvps_complete: boolean;
  computed_at: string;
}

interface CoachingGap {
  dimension: string;
  gap: string;
  points: number;
  action: string;
  coaching_prompt?: string;
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  TIER_1_EXCEPTIONAL: { label: 'EXCEPTIONAL', color: 'var(--vp-brg, #004225)' },
  TIER_2_COMPETITIVE: { label: 'COMPETITIVE', color: 'var(--vp-gulf-blue, #001f3f)' },
  TIER_3_VIABLE: { label: 'VIABLE', color: 'var(--vp-ink, #1a1a1a)' },
  TIER_4_INCOMPLETE: { label: 'INCOMPLETE', color: 'var(--vp-pencil, #666)' },
  DISCOVERY_ONLY: { label: 'DISCOVERY', color: 'var(--vp-pencil, #999)' },
};

const DIMENSIONS: Array<{ key: keyof ArsData; label: string }> = [
  { key: 'identity_score', label: 'IDENTITY' },
  { key: 'photo_score', label: 'PHOTOS' },
  { key: 'doc_score', label: 'DOCS' },
  { key: 'desc_score', label: 'DESCRIPTION' },
  { key: 'market_score', label: 'MARKET' },
  { key: 'condition_score', label: 'CONDITION' },
];

const ACTION_BADGES: Record<string, string> = {
  PHOTO_UPLOAD: 'PHOTO',
  DATA_SUPPLY: 'DATA',
  NARRATIVE_WRITE: 'WRITE',
  DOC_UPLOAD: 'DOC',
  VERIFY_CLAIM: 'VERIFY',
};

const AuctionReadinessPanel: React.FC = () => {
  const { vehicle, hasContributorAccess, isAdminUser, isRowOwner, isVerifiedOwner } = useVehicleProfile();
  const [ars, setArs] = useState<ArsData | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const canView = isRowOwner || isVerifiedOwner || hasContributorAccess || isAdminUser;

  useEffect(() => {
    if (!vehicle?.id || !canView) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('auction_readiness')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .maybeSingle();
      if (!cancelled && !error && data) setArs(data as ArsData);
    })();
    return () => { cancelled = true; };
  }, [vehicle?.id, canView]);

  if (!canView || !ars) return null;

  const tierInfo = TIER_LABELS[ars.tier] || TIER_LABELS.DISCOVERY_ONLY;
  const coaching = Array.isArray(ars.coaching_plan) ? ars.coaching_plan : [];
  const mvpsCount = (ars.photo_zones_present || []).length;

  return (
    <div className={`widget ${collapsed ? 'widget--collapsed' : ''}`} id="widgetARS">
      <div className="widget__header">
        <div className="widget__header-left">
          <span className="widget__label">Auction Readiness</span>
          <span
            className="widget__count"
            style={{ color: tierInfo.color, fontWeight: 700 }}
          >
            {ars.composite_score}/100
          </span>
        </div>
        <div className="widget__controls" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              fontFamily: 'var(--vp-font-mono, "Courier New", monospace)',
              fontSize: '7px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase' as const,
              padding: '1px 5px',
              border: '1px solid currentColor',
              color: tierInfo.color,
            }}
          >
            {tierInfo.label}
          </span>
          <button
            className="widget__toggle"
            onClick={() => setCollapsed(!collapsed)}
            title="Toggle"
          >
            {collapsed ? '\u25B6' : '\u25BC'}
          </button>
        </div>
      </div>

      <div className="widget__body">
        {/* Dimension bars */}
        {DIMENSIONS.map(({ key, label }) => {
          const val = (ars[key] as number) ?? 0;
          return (
            <div className="score-row" key={key}>
              <div className="score-row__label">{label}</div>
              <div className="score-row__bar">
                <div className="score-row__bar-fill" style={{ width: `${val}%` }} />
              </div>
              <div className={`score-row__value ${val === 0 ? 'score-row__value--null' : ''}`}>
                {val}
              </div>
            </div>
          );
        })}

        {/* MVPS status */}
        <div
          style={{
            margin: '8px 0 4px',
            fontFamily: 'var(--vp-font-sans, Arial, sans-serif)',
            fontSize: '8px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: 'var(--vp-pencil, #666)',
          }}
        >
          REQUIRED PHOTO ZONES: {mvpsCount}/8
          {ars.mvps_complete && (
            <span style={{ color: 'var(--vp-brg, #004225)', marginLeft: '6px', fontWeight: 700 }}>
              COMPLETE
            </span>
          )}
        </div>
        {(ars.photo_zones_missing || []).length > 0 && (
          <div
            style={{
              fontFamily: 'var(--vp-font-mono, "Courier New", monospace)',
              fontSize: '8px',
              color: 'var(--vp-pencil, #666)',
              lineHeight: '1.5',
            }}
          >
            Missing: {(ars.photo_zones_missing || []).map(z => z.replace(/_/g, ' ')).join(', ')}
          </div>
        )}

        {/* Coaching actions */}
        {coaching.length > 0 && (
          <div style={{ marginTop: '10px' }}>
            <div
              style={{
                fontFamily: 'var(--vp-font-sans, Arial, sans-serif)',
                fontSize: '8px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase' as const,
                color: 'var(--vp-ink, #1a1a1a)',
                marginBottom: '6px',
              }}
            >
              COACHING ACTIONS
            </div>
            {coaching.slice(0, 8).map((gap, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr 28px',
                  alignItems: 'start',
                  gap: '6px',
                  padding: '3px 0',
                  borderBottom: '1px solid var(--vp-rule, #e0e0e0)',
                  fontFamily: 'var(--vp-font-sans, Arial, sans-serif)',
                  fontSize: '8px',
                  lineHeight: '1.5',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--vp-font-mono, "Courier New", monospace)',
                    fontSize: '7px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase' as const,
                    padding: '1px 3px',
                    border: '1px solid var(--vp-rule, #ccc)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ACTION_BADGES[gap.action] || gap.action}
                </span>
                <span style={{ color: 'var(--vp-ink, #1a1a1a)' }}>
                  {gap.gap}
                  {gap.coaching_prompt && (
                    <span style={{ display: 'block', color: 'var(--vp-pencil, #888)', fontSize: '7px', marginTop: '1px' }}>
                      {gap.coaching_prompt}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--vp-font-mono, "Courier New", monospace)',
                    fontSize: '7px',
                    fontWeight: 600,
                    textAlign: 'right',
                    color: 'var(--vp-pencil, #666)',
                  }}
                >
                  +{gap.points}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuctionReadinessPanel;
