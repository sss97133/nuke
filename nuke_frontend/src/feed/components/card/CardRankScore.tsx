/**
 * CardRankScore — Transparent feed rank score breakdown.
 *
 * Shows a small score badge on the card. On hover, expands to show
 * the component breakdown of the feed_rank_score formula.
 *
 * This is the "show your work" component — makes the algorithm inspectable.
 */

import { useState, type CSSProperties } from 'react';
import type { FeedVehicle } from '../../types/feed';

export interface CardRankScoreProps {
  vehicle: FeedVehicle;
  compact?: boolean;
}

interface ScoreComponent {
  label: string;
  value: number;
  color: string;
}

/**
 * Decompose feed_rank_score into its component parts.
 * This mirrors the SQL formula in the MV — keep them in sync.
 */
function decomposeScore(v: FeedVehicle): ScoreComponent[] {
  const components: ScoreComponent[] = [];

  // 1. Deal score * recency
  const dealScore = v.deal_score ?? 0;
  const ageHours = (Date.now() - new Date(v.created_at).getTime()) / 3600000;
  const recency = ageHours < 24 ? 1.0 : ageHours < 72 ? 0.95 : ageHours < 168 ? 0.85 : ageHours < 720 ? 0.5 : 0.3;
  const dealContrib = dealScore * recency;
  if (dealContrib !== 0) {
    components.push({
      label: `DEAL × ${recency.toFixed(2)}`,
      value: Math.round(dealContrib * 10) / 10,
      color: dealContrib > 30 ? '#16825d' : dealContrib > 10 ? '#2d9d78' : 'var(--text-secondary)',
    });
  }

  // 2. Heat score
  const heatContrib = (v.heat_score ?? 0) * 0.3;
  if (heatContrib !== 0) {
    components.push({
      label: 'HEAT',
      value: Math.round(heatContrib * 10) / 10,
      color: heatContrib > 5 ? 'var(--error)' : 'var(--text-secondary)',
    });
  }

  // 3. For-sale quality boost
  if (v.is_for_sale) {
    const price = v.display_price ?? 0;
    const priceBoost = price >= 10000 ? 25 : price >= 5000 ? 20 : price >= 2000 ? 10 : price >= 500 ? 0 : -20;

    const freshBoost = ageHours < 24 ? 20 : ageHours < 72 ? 12 : ageHours < 168 ? 5 : ageHours < 720 ? 0 : -15;

    const forSaleTotal = priceBoost + freshBoost;
    components.push({
      label: 'FOR SALE',
      value: forSaleTotal,
      color: forSaleTotal > 20 ? 'var(--info)' : forSaleTotal > 0 ? '#6b9dfc' : '#d13438',
    });
  }

  // 4. Vehicle type
  // Can't decompose exactly without canonical_vehicle_type in FeedVehicle,
  // but we can note the source quality
  const source = v.discovery_source ?? '';
  const trustedSources = ['bat_core', 'bat_simple', 'cars_and_bids', 'pcarmarket',
    'barrett-jackson', 'rm_sothebys', 'mecum', 'gooding', 'bonhams',
    'hagerty_marketplace', 'classic_driver'];
  const sourceBoost = trustedSources.includes(source) ? 10 :
    source === 'craigslist_scrape' || source === 'ksl' ? 2 :
    source === 'facebook_marketplace' ? 0 : 1;

  if (sourceBoost !== 0) {
    components.push({
      label: 'SOURCE',
      value: sourceBoost,
      color: sourceBoost >= 10 ? '#16825d' : 'var(--text-secondary)',
    });
  }

  // 5. Photo boost (approximate — we can tell from thumbnail_url)
  const hasPhotos = !!v.thumbnail_url;
  components.push({
    label: 'PHOTOS',
    value: hasPhotos ? 8 : -2,
    color: hasPhotos ? '#16825d' : '#d13438',
  });

  // 6. Location
  if (v.location || v.city) {
    components.push({ label: 'LOCATION', value: 2, color: 'var(--text-secondary)' });
  }

  // 7. Confidence
  const conf = v.nuke_estimate_confidence;
  if (conf && conf >= 0.5) {
    components.push({
      label: 'CONFIDENCE',
      value: conf >= 0.8 ? 3 : 1,
      color: 'var(--text-secondary)',
    });
  }

  return components;
}

const badgeStyle: CSSProperties = {
  position: 'absolute',
  top: '2px',
  left: '2px',
  fontFamily: "'Courier New', monospace",
  fontSize: 'var(--feed-font-size-xs, 7px)',
  fontWeight: 700,
  padding: '1px 3px',
  background: 'rgba(0, 0, 0, 0.75)',
  color: 'var(--surface-elevated)',
  zIndex: 5,
  cursor: 'default',
  lineHeight: 1.3,
};

const tooltipStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: '2px',
  background: 'rgba(0, 0, 0, 0.92)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  padding: '4px 6px',
  zIndex: 100,
  minWidth: '120px',
  whiteSpace: 'nowrap',
};

export function CardRankScore({ vehicle, compact }: CardRankScoreProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const score = vehicle.feed_rank_score;
  if (score == null) return null;

  const components = showBreakdown ? decomposeScore(vehicle) : [];
  const total = components.reduce((sum, c) => sum + c.value, 0);

  const scoreColor = score > 60 ? '#16825d' : score > 30 ? '#b05a00' : score > 0 ? 'var(--text-secondary)' : '#d13438';

  if (compact) {
    return (
      <span style={{ ...badgeStyle, color: scoreColor }}>
        {Math.round(score)}
      </span>
    );
  }

  return (
    <span
      style={{ ...badgeStyle, position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShowBreakdown(true)}
      onMouseLeave={() => setShowBreakdown(false)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowBreakdown(!showBreakdown); }}
    >
      <span style={{ color: scoreColor }}>{Math.round(score)}</span>
      <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: '2px' }}>R</span>

      {showBreakdown && (
        <span style={tooltipStyle}>
          {components.map((c, i) => (
            <span key={i} style={{
              display: 'flex', justifyContent: 'space-between', gap: '8px',
              fontFamily: "'Courier New', monospace",
              fontSize: '7px', lineHeight: 1.6,
            }}>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>{c.label}</span>
              <span style={{ color: c.color, fontWeight: 700 }}>
                {c.value > 0 ? '+' : ''}{c.value}
              </span>
            </span>
          ))}
          <span style={{
            display: 'flex', justifyContent: 'space-between', gap: '8px',
            fontFamily: "'Courier New', monospace",
            fontSize: '7px', lineHeight: 1.6,
            borderTop: '1px solid rgba(255,255,255,0.2)',
            marginTop: '2px', paddingTop: '2px',
          }}>
            <span style={{ color: 'var(--surface-elevated)' }}>TOTAL (est)</span>
            <span style={{ color: scoreColor, fontWeight: 700 }}>{Math.round(total)}</span>
          </span>
          <span style={{
            display: 'block', fontFamily: 'Arial, sans-serif',
            fontSize: '6px', color: 'rgba(255,255,255,0.3)', marginTop: '2px',
          }}>
            actual: {Math.round(score)} (DB)
          </span>
        </span>
      )}
    </span>
  );
}
