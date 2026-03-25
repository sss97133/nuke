/**
 * VehicleCard — Composable vehicle card built from atomic widgets.
 *
 * Replaces VehicleCardDense (3,197 lines) with a composable ~160-line card.
 * Supports grid / gallery / technical view modes.
 */

import { useCallback, useMemo, type CSSProperties } from 'react';
import type { FeedVehicle, FeedViewConfig } from '../types/feed';
import { resolveVehiclePrice } from '../utils/feedPriceResolution';
import { vehicleTimeLabel } from '../utils/timeAgo';
import { CardShell } from './card/CardShell';
import { CardImage } from './card/CardImage';
import { CardIdentity } from './card/CardIdentity';
import { CardDealScore } from './card/CardDealScore';
import { resolveSourceLabel } from './card/CardSource';
import { CardActions } from './card/CardActions';
import { usePopup } from '../../components/popups/usePopup';
import { VehiclePopup } from '../../components/popups/VehiclePopup';

export interface VehicleCardProps {
  vehicle: FeedVehicle;
  viewMode: FeedViewConfig['viewMode'];
  compact?: boolean;
  showActions?: boolean;
  showScores?: boolean;
  imageFit?: 'cover' | 'contain';
  isFollowing?: boolean;
  isFollowLoading?: boolean;
  onToggleFollow?: () => void;
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
  /** Whether user has previously viewed this vehicle */
  viewed?: boolean;
  style?: CSSProperties;
}

export function VehicleCard({
  vehicle,
  viewMode,
  compact = false,
  showActions = false,
  showScores = false,
  imageFit,
  isFollowing = false,
  isFollowLoading = false,
  onToggleFollow,
  onHoverStart,
  onHoverEnd,
  viewed = false,
  style,
}: VehicleCardProps) {
  const { openPopup } = usePopup();
  const price = useMemo(() => resolveVehiclePrice(vehicle), [vehicle]);
  const timeLabel = useMemo(() => vehicleTimeLabel(vehicle), [vehicle]);

  const sourceLabel = useMemo(
    () => resolveSourceLabel(vehicle.discovery_url, vehicle.discovery_source, vehicle.profile_origin),
    [vehicle.discovery_url, vehicle.discovery_source, vehicle.profile_origin],
  );

  const handleCardClick = useCallback(() => {
    const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
    openPopup(<VehiclePopup vehicle={vehicle} />, title, 420);
  }, [vehicle, openPopup]);

  const alt = [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .join(' ') || 'Vehicle';

  const noImageData = {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    mileage: vehicle.mileage,
    transmission: vehicle.transmission,
    drivetrain: vehicle.drivetrain,
    bodyStyle: vehicle.canonical_body_style || vehicle.body_style,
    price: price.formatted,
  };

  if (viewMode === 'technical') {
    const DEAL_MAP: Record<string, { label: string; color: string; bg: string }> = {
      plus_3: { label: 'STEAL', color: 'var(--surface-elevated)', bg: '#16825d' },
      plus_2: { label: 'GREAT', color: 'var(--surface-elevated)', bg: '#1a7a54' },
      plus_1: { label: 'GOOD', color: 'var(--surface-elevated)', bg: '#2d9d78' },
      minus_1: { label: 'ABOVE', color: 'var(--surface-elevated)', bg: '#b05a00' },
      minus_2: { label: 'OVER', color: 'var(--surface-elevated)', bg: '#d13438' },
      minus_3: { label: 'WAY+', color: 'var(--surface-elevated)', bg: '#a4262c' },
    };
    const HEAT_MAP: Record<string, string> = {
      volcanic: '#d13438', fire: 'var(--error)', hot: 'var(--warning)', warm: '#b05a00',
    };

    const deal = vehicle.deal_score_label && vehicle.deal_score_label !== 'fair'
      ? DEAL_MAP[vehicle.deal_score_label] : null;
    const heatColor = vehicle.heat_score_label ? HEAT_MAP[vehicle.heat_score_label] : null;

    const mono = "'Courier New', monospace";
    const sans = 'Arial, sans-serif';
    const fs = 'var(--feed-font-size, 12px)';
    const fsSm = 'var(--feed-font-size-sm, 10px)';

    return (
      <CardShell vehicleId={vehicle.id} viewMode="technical" style={style}>
        {/* Thumbnail */}
        <CardImage thumbnailUrl={vehicle.thumbnail_url} alt={alt} viewMode="technical" />
        {/* Year */}
        <span style={{ fontFamily: mono, fontSize: fs, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {vehicle.year ?? '—'}
        </span>
        {/* Make */}
        <span style={{ fontFamily: sans, fontSize: fsSm, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vehicle.make ?? '—'}
        </span>
        {/* Model */}
        <span style={{ fontFamily: sans, fontSize: fs, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vehicle.model ?? '—'}
        </span>
        {/* Mileage */}
        <span style={{ fontFamily: mono, fontSize: fs, textAlign: 'right', color: 'var(--text-secondary)' }}>
          {vehicle.mileage ? Math.floor(vehicle.mileage).toLocaleString() : '—'}
        </span>
        {/* Price */}
        <span style={{ fontFamily: mono, fontSize: fs, textAlign: 'right', fontWeight: 700 }}>
          {price.formatted}
        </span>
        {/* Body */}
        <span style={{ fontFamily: sans, fontSize: fsSm, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vehicle.canonical_body_style || '—'}
        </span>
        {/* Transmission */}
        <span style={{ fontFamily: sans, fontSize: fsSm, color: 'var(--text-secondary)' }}>
          {vehicle.transmission ? (vehicle.transmission.toLowerCase().includes('manual') ? 'MAN' : 'AUTO') : '—'}
        </span>
        {/* Deal */}
        {deal ? (
          <span style={{
            fontFamily: sans, fontSize: '9px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            padding: '2px 5px', lineHeight: 1,
            color: deal.color, background: deal.bg,
            display: 'inline-block', width: 'fit-content',
          }}>
            {deal.label}
          </span>
        ) : <span />}
        {/* Heat */}
        {heatColor ? (
          <span style={{
            fontFamily: sans, fontSize: '9px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            color: heatColor,
          }}>
            {vehicle.heat_score_label!.toUpperCase()}
          </span>
        ) : <span />}
        {/* Time */}
        <span style={{
          fontFamily: mono, fontSize: fsSm,
          color: timeLabel?.startsWith('sold') ? 'var(--success)'
            : timeLabel?.startsWith('ends') ? 'var(--error)'
            : 'var(--text-disabled)',
          textAlign: 'right',
        }}>
          {timeLabel || '—'}
        </span>
        {/* Rank */}
        {showScores && (
          <span style={{
            fontFamily: mono, fontSize: fsSm,
            fontWeight: 700, textAlign: 'right',
            color: (vehicle.feed_rank_score ?? 0) > 60 ? '#16825d'
              : (vehicle.feed_rank_score ?? 0) > 30 ? '#b05a00'
              : 'var(--text-disabled)',
          }}>
            {vehicle.feed_rank_score != null ? Math.round(vehicle.feed_rank_score) : '—'}
          </span>
        )}
      </CardShell>
    );
  }

  if (viewMode === 'gallery') {
    // List row — horizontal layout, richer than before
    return (
      <CardShell
        vehicleId={vehicle.id}
        viewMode="gallery"
        onHoverStart={onHoverStart}
        onHoverEnd={onHoverEnd}
        style={style}
      >
        <CardImage thumbnailUrl={vehicle.thumbnail_url} alt={alt} viewMode="gallery" noImageData={noImageData} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {/* Row 1: title + price */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
            <CardIdentity
              year={vehicle.year}
              make={vehicle.make}
              model={vehicle.model}
              series={vehicle.series}
              trim={vehicle.trim}
              compact
            />
            <span style={{ display: 'flex', alignItems: 'baseline', gap: '4px', flexShrink: 0 }}>
              {vehicle.is_for_sale && (
                <span style={{
                  fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size-xs, 7px)',
                  fontWeight: 800, textTransform: 'uppercase',
                  color: 'var(--info)', letterSpacing: '0.3px',
                }}>
                  FOR SALE
                </span>
              )}
              <span style={{
                fontFamily: "'Courier New', monospace",
                fontSize: 'var(--feed-font-size, 11px)',
                fontWeight: 700,
                color: 'var(--text)',
              }}>
                {price.formatted}
              </span>
            </span>
          </div>
          {/* Row 2: source + meta + chips + deal + time */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingLeft: '4px', flexWrap: 'wrap' }}>
            {sourceLabel && (
              <span style={{
                fontFamily: "'Courier New', monospace",
                fontSize: 'var(--feed-font-size-xs, 7px)',
                fontWeight: 700,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.5px',
                padding: '1px 4px',
                border: '2px solid var(--text-tertiary, var(--border))',
                color: 'var(--text-tertiary, var(--text-secondary))',
              }}>
                {sourceLabel}
              </span>
            )}
            {price.isSold && price.showSoldBadge && (
              <span style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 'var(--feed-font-size-xs, 7px)',
                fontWeight: 800,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.3px',
                color: 'var(--success)',
              }}>
                SOLD
              </span>
            )}
            <span style={{
              fontFamily: "'Courier New', monospace", fontSize: 'var(--feed-font-size-sm, 9px)',
              color: 'var(--text-secondary)', whiteSpace: 'nowrap',
            }}>
              {vehicle.mileage ? `${Math.floor(vehicle.mileage).toLocaleString()} mi` : ''}
              {vehicle.mileage && vehicle.transmission ? ' / ' : ''}
              {vehicle.transmission ? (vehicle.transmission.toLowerCase().includes('manual') ? 'Manual' : vehicle.transmission.toLowerCase().includes('auto') ? 'Auto' : '') : ''}
            </span>
            {(vehicle.canonical_body_style || vehicle.body_style) && (
              <span style={{
                fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size-xs, 7px)', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.3px',
                padding: '1px 4px', border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}>
                {vehicle.canonical_body_style || vehicle.body_style}
              </span>
            )}
            {vehicle.location && (
              <span style={{
                fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size-xs, 7px)', fontWeight: 700,
                color: 'var(--text-disabled)', whiteSpace: 'nowrap',
              }}>
                {vehicle.location}
              </span>
            )}
            {vehicle.deal_score_label && vehicle.deal_score_label !== 'fair' && (
              <CardDealScore dealScoreLabel={vehicle.deal_score_label} heatScoreLabel={vehicle.heat_score_label} />
            )}
            {timeLabel && (
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: 'var(--feed-font-size-sm, 8px)',
                color: timeLabel.startsWith('sold') ? 'var(--success)'
                  : timeLabel.startsWith('ends') ? 'var(--error)'
                  : timeLabel.startsWith('listed') ? 'var(--info)'
                  : 'var(--text-disabled)',
              }}>
                {timeLabel}
              </span>
            )}
            {showScores && vehicle.feed_rank_score != null && (
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: 'var(--feed-font-size-xs, 7px)',
                fontWeight: 700,
                color: vehicle.feed_rank_score > 60 ? '#16825d' : vehicle.feed_rank_score > 30 ? '#b05a00' : 'var(--text-disabled)',
                padding: '0 3px',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border)',
              }}>
                {Math.round(vehicle.feed_rank_score)}R
              </span>
            )}
          </div>
        </div>
      </CardShell>
    );
  }

  // Expanded content for grid cards — compact vertical stack within single column width.
  // Shows: price context, extra specs (stacked), source provenance.
  // No side-by-side grids — everything stacks vertically to fit card column.
  const expandedContent = useMemo(() => {
    // Build price context line
    const priceContextParts: string[] = [];
    if (vehicle.nuke_estimate != null && vehicle.nuke_estimate > 0 && price.amount) {
      const diff = price.amount - vehicle.nuke_estimate;
      const pct = Math.round((diff / vehicle.nuke_estimate) * 100);
      const dir = pct > 0 ? 'above' : pct < 0 ? 'below' : 'at';
      const absPct = Math.abs(pct);
      if (absPct > 2) {
        priceContextParts.push(
          `${price.isSold ? 'Sold' : 'Priced'} ${absPct}% ${dir} estimate ($${vehicle.nuke_estimate.toLocaleString()})`
        );
      } else {
        priceContextParts.push(`At estimate ($${vehicle.nuke_estimate.toLocaleString()})`);
      }
    } else if (vehicle.nuke_estimate != null && vehicle.nuke_estimate > 0) {
      priceContextParts.push(`Estimate: $${vehicle.nuke_estimate.toLocaleString()}`);
    }

    // Confidence — stored as 0-100 integer
    const conf = vehicle.nuke_estimate_confidence;
    const confDisplay = conf != null ? (conf > 1 ? Math.round(conf) : Math.round(conf * 100)) : null;
    const confColor = confDisplay != null
      ? (confDisplay >= 70 ? '#16825d' : confDisplay >= 40 ? '#b05a00' : 'var(--text-secondary)')
      : null;

    // Build extra specs not visible in collapsed card (VIN, engine, location, fuel)
    const extraSpecs: { label: string; value: string }[] = [];
    if (vehicle.engine_size) extraSpecs.push({ label: 'ENGINE', value: vehicle.engine_size });
    if (vehicle.vin) extraSpecs.push({ label: 'VIN', value: `...${vehicle.vin.slice(-8)}` });
    if (vehicle.location) extraSpecs.push({ label: 'LOC', value: vehicle.location });
    if (vehicle.fuel_type) extraSpecs.push({ label: 'FUEL', value: vehicle.fuel_type });

    // Source + provenance line
    const sourceParts: string[] = [];
    if (sourceLabel) sourceParts.push(sourceLabel);
    if (vehicle.image_count != null && vehicle.image_count > 1) {
      sourceParts.push(`${vehicle.image_count} photos`);
    }
    if (vehicle.bid_count != null && vehicle.bid_count > 0) {
      sourceParts.push(`${vehicle.bid_count} bids`);
    }

    const mono = "'Courier New', monospace";
    const sans = 'Arial, sans-serif';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Price context — estimate comparison */}
        {priceContextParts.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 6px',
            border: '2px solid var(--border)',
            background: 'var(--surface)',
          }}>
            <span style={{
              fontFamily: mono, fontSize: '9px', fontWeight: 700,
              color: 'var(--text)', lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {priceContextParts[0]}
            </span>
            {confDisplay != null && (
              <span style={{
                fontFamily: mono, fontSize: '8px', fontWeight: 700,
                color: confColor!,
                marginLeft: 'auto',
                flexShrink: 0,
              }}>
                {confDisplay}%
              </span>
            )}
          </div>
        )}

        {/* Deal score — inline, only if notable */}
        {vehicle.deal_score_label && vehicle.deal_score_label !== 'fair' && (
          <div style={{
            padding: '3px 6px',
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <CardDealScore dealScoreLabel={vehicle.deal_score_label} heatScoreLabel={vehicle.heat_score_label} />
            {vehicle.heat_score_label && (
              <span style={{
                fontFamily: sans, fontSize: '8px', fontWeight: 700,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.3px',
                color: vehicle.heat_score_label === 'volcanic' || vehicle.heat_score_label === 'fire'
                  ? 'var(--error)' : vehicle.heat_score_label === 'hot' || vehicle.heat_score_label === 'warm'
                  ? 'var(--warning)' : 'var(--text-secondary)',
              }}>
                {vehicle.heat_score_label.toUpperCase()}
              </span>
            )}
          </div>
        )}

        {/* Extra specs — vertically stacked, one per line */}
        {extraSpecs.length > 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            border: '2px solid var(--border)',
          }}>
            {extraSpecs.map((spec, i) => (
              <div key={spec.label} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 6px',
                background: 'var(--surface)',
                borderTop: i > 0 ? '1px solid var(--border)' : undefined,
              }}>
                <span style={{
                  fontFamily: sans, fontSize: '7px', fontWeight: 800,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.5px',
                  color: 'var(--text-disabled)',
                  lineHeight: 1,
                  flexShrink: 0,
                }}>
                  {spec.label}
                </span>
                <span style={{
                  fontFamily: mono, fontSize: '9px', fontWeight: 700,
                  color: 'var(--text)', lineHeight: 1.2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  textAlign: 'right',
                }}>
                  {spec.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Source + provenance line */}
        {sourceParts.length > 0 && (
          <div style={{
            fontFamily: mono, fontSize: '8px', fontWeight: 700,
            color: 'var(--text-disabled)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.3px',
            lineHeight: 1,
          }}>
            {sourceParts.join(' \u00B7 ')}
          </div>
        )}
      </div>
    );
  }, [vehicle, price, sourceLabel]);

  // --- Build the info line parts for grid mode ---
  const infoLineParts = useMemo(() => {
    const parts: string[] = [];
    if (sourceLabel) parts.push(sourceLabel);
    if (price.isLive) parts.push('LIVE');
    else if (price.isSold && price.showSoldBadge) parts.push('SOLD');
    else if (vehicle.is_for_sale) parts.push('FOR SALE');
    else if (price.isResult) parts.push('ENDED');
    if (timeLabel) parts.push(timeLabel.toUpperCase());
    return parts;
  }, [sourceLabel, price, vehicle.is_for_sale, timeLabel]);

  // --- Build the price text for the info line ---
  const infoPriceText = useMemo(() => {
    if (price.isLive) return `BID ${price.formatted}`;
    if (price.isSold && price.showSoldBadge) return `SOLD ${price.formatted}`;
    if (vehicle.is_for_sale && !price.isSold && !price.isLive) return `ASKING ${price.formatted}`;
    if (price.isResult) return `RESULT ${price.formatted}`;
    if (price.amount) return price.formatted;
    return null;
  }, [price, vehicle.is_for_sale]);

  const infoPriceColor = price.isSold ? 'var(--success)'
    : price.isLive ? 'var(--text)'
    : price.isResult ? 'var(--warning)'
    : 'var(--text)';

  // Grid mode (default) — clean image, all info below
  // Click opens centered popup overlay (no grid reflow)
  return (
    <CardShell
      vehicleId={vehicle.id}
      viewMode="grid"
      expandedContent={expandedContent}
      popupImageUrl={vehicle.thumbnail_url}
      popupTitle={alt}
      popupPrice={infoPriceText || undefined}
      onHoverStart={onHoverStart}
      onHoverEnd={onHoverEnd}
      onCardClick={handleCardClick}
      style={style}
    >
      <CardImage thumbnailUrl={vehicle.thumbnail_url} alt={alt} viewMode="grid" fit={imageFit} noImageData={noImageData}>
        {/* Only interactive elements on image — follow button */}
        {showActions && onToggleFollow && (
          <CardActions
            isFollowing={isFollowing}
            isLoading={isFollowLoading}
            onToggleFollow={onToggleFollow}
          />
        )}
      </CardImage>

      <CardIdentity
        year={vehicle.year}
        make={vehicle.make}
        model={vehicle.model}
        series={vehicle.series}
        trim={vehicle.trim}
        compact={compact}
      />

      {/* Single info line: SOURCE · STATUS · TIME        PRICE */}
      <div style={{
        padding: compact ? '0 4px 4px' : '0 8px 6px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '6px',
        minHeight: compact ? '14px' : '16px',
      }}>
        {/* Left: source · status · time */}
        <span style={{
          fontFamily: "'Courier New', monospace",
          fontSize: compact ? '7px' : '8px',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--text-secondary)',
          lineHeight: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {viewed && (
            <span>
              <span style={{ color: 'var(--text-disabled)', fontSize: compact ? '6px' : '7px' }}>VIEWED</span>
              {infoLineParts.length > 0 && (
                <span style={{ color: 'var(--text-disabled)', margin: '0 4px' }}>{'\u00B7'}</span>
              )}
            </span>
          )}
          {infoLineParts.map((part, i) => (
            <span key={i}>
              {i > 0 && (
                <span style={{ color: 'var(--text-disabled)', margin: '0 4px' }}>{'\u00B7'}</span>
              )}
              <span style={{
                color: part === 'LIVE' ? 'var(--info)'
                  : part === 'SOLD' ? 'var(--success)'
                  : part === 'FOR SALE' ? 'var(--info)'
                  : part === 'ENDED' ? 'var(--warning)'
                  : part.startsWith('ENDS') ? 'var(--error)'
                  : part.startsWith('SOLD') ? 'var(--success)'
                  : part.startsWith('LISTED') ? 'var(--info)'
                  : 'var(--text-secondary)',
              }}>
                {part}
              </span>
            </span>
          ))}
        </span>

        {/* Right: price */}
        {infoPriceText && (
          <span style={{
            fontFamily: "'Courier New', monospace",
            fontSize: compact ? '9px' : '11px',
            fontWeight: 700,
            color: infoPriceColor,
            lineHeight: 1,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}>
            {infoPriceText}
          </span>
        )}
      </div>
    </CardShell>
  );
}
