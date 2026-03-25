/**
 * VehicleCard — Composable vehicle card built from atomic widgets.
 *
 * Replaces VehicleCardDense (3,197 lines) with a composable ~160-line card.
 * Supports grid / gallery / technical view modes.
 */

import { useMemo, type CSSProperties } from 'react';
import type { FeedVehicle, FeedViewConfig } from '../types/feed';
import { resolveVehiclePrice } from '../utils/feedPriceResolution';
import { vehicleTimeLabel } from '../utils/timeAgo';
import { CardShell } from './card/CardShell';
import { CardImage } from './card/CardImage';
import { CardIdentity } from './card/CardIdentity';
import { CardDealScore } from './card/CardDealScore';
import { resolveSourceLabel } from './card/CardSource';
import { CardActions } from './card/CardActions';
import { BadgePortal } from '../../components/badges/BadgePortal';

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
  style,
}: VehicleCardProps) {
  const price = useMemo(() => resolveVehiclePrice(vehicle), [vehicle]);
  const timeLabel = useMemo(() => vehicleTimeLabel(vehicle), [vehicle]);

  const sourceLabel = useMemo(
    () => resolveSourceLabel(vehicle.discovery_url, vehicle.discovery_source, vehicle.profile_origin),
    [vehicle.discovery_url, vehicle.discovery_source, vehicle.profile_origin],
  );

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

  // Build spec entries for the expanded key-specs grid
  const specEntries = useMemo(() => {
    const entries: { label: string; value: string }[] = [];
    if (vehicle.mileage) entries.push({ label: 'MILEAGE', value: `${Math.floor(vehicle.mileage).toLocaleString()} mi` });
    if (vehicle.transmission) {
      const t = vehicle.transmission.toLowerCase();
      entries.push({
        label: 'TRANS',
        value: t.includes('manual') ? 'Manual' : t.includes('auto') ? 'Automatic' : vehicle.transmission,
      });
    }
    if (vehicle.drivetrain) entries.push({ label: 'DRIVE', value: vehicle.drivetrain.toUpperCase() });
    if (vehicle.engine_size) entries.push({ label: 'ENGINE', value: vehicle.engine_size });
    if (vehicle.fuel_type) entries.push({ label: 'FUEL', value: vehicle.fuel_type });
    if (vehicle.canonical_body_style || vehicle.body_style)
      entries.push({ label: 'BODY', value: (vehicle.canonical_body_style || vehicle.body_style)! });
    if (vehicle.vin) entries.push({ label: 'VIN', value: `...${vehicle.vin.slice(-8)}` });
    if (vehicle.location) entries.push({ label: 'LOCATION', value: vehicle.location });
    return entries;
  }, [vehicle]);

  // Expanded content for grid cards — hero image, key specs, BadgePortals
  const expandedContent = useMemo(() => (
    <div>
      {/* Hero image — larger view of the thumbnail */}
      {vehicle.thumbnail_url && (
        <div style={{
          width: '100%',
          paddingTop: '50%',
          position: 'relative',
          background: 'var(--surface-hover)',
          marginBottom: '8px',
          overflow: 'hidden',
        }}>
          <img
            src={vehicle.thumbnail_url}
            alt={alt}
            loading="lazy"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          {/* Image count overlay */}
          {vehicle.image_count != null && vehicle.image_count > 1 && (
            <span style={{
              position: 'absolute',
              bottom: '4px',
              right: '6px',
              fontFamily: "'Courier New', monospace",
              fontSize: '8px',
              fontWeight: 700,
              color: 'white',
              background: 'rgba(0,0,0,0.65)',
              padding: '2px 5px',
              letterSpacing: '0.3px',
            }}>
              {vehicle.image_count} PHOTOS
            </span>
          )}
        </div>
      )}

      {/* Key specs grid — 2-column layout */}
      {specEntries.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '1px',
          background: 'var(--border)',
          border: '1px solid var(--border)',
          marginBottom: '8px',
        }}>
          {specEntries.map((spec) => (
            <div key={spec.label} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1px',
              padding: '4px 6px',
              background: 'var(--surface)',
            }}>
              <span style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: '7px',
                fontWeight: 800,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.5px',
                color: 'var(--text-disabled)',
                lineHeight: 1,
              }}>
                {spec.label}
              </span>
              <span style={{
                fontFamily: "'Courier New', monospace",
                fontSize: '9px',
                fontWeight: 700,
                color: 'var(--text)',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {spec.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Price context — estimate + deal score */}
      {(vehicle.nuke_estimate || vehicle.deal_score_label) && (
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          marginBottom: '8px',
          padding: '4px 6px',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
        }}>
          {vehicle.nuke_estimate != null && vehicle.nuke_estimate > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span style={{
                fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-disabled)',
                lineHeight: 1,
              }}>
                ESTIMATE
              </span>
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: '10px', fontWeight: 700,
                color: 'var(--text)', lineHeight: 1.2,
              }}>
                ${vehicle.nuke_estimate.toLocaleString()}
              </span>
            </div>
          )}
          {vehicle.nuke_estimate_confidence != null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span style={{
                fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-disabled)',
                lineHeight: 1,
              }}>
                CONF
              </span>
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: '10px', fontWeight: 700,
                color: vehicle.nuke_estimate_confidence >= 0.7 ? '#16825d'
                  : vehicle.nuke_estimate_confidence >= 0.4 ? '#b05a00'
                  : 'var(--text-secondary)',
                lineHeight: 1.2,
              }}>
                {Math.round(vehicle.nuke_estimate_confidence * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Badge portal row — explore by dimension */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        marginBottom: '4px',
      }}>
        {vehicle.year && (
          <BadgePortal dimension="year" value={vehicle.year} label={String(vehicle.year)} variant="source" />
        )}
        {vehicle.make && (
          <BadgePortal dimension="make" value={vehicle.make} label={vehicle.make} variant="source" />
        )}
        {vehicle.model && (
          <BadgePortal dimension="model" value={vehicle.model} label={vehicle.model} variant="source" />
        )}
        {(vehicle.canonical_body_style || vehicle.body_style) && (
          <BadgePortal
            dimension="body_style"
            value={vehicle.canonical_body_style || vehicle.body_style || ''}
            label={vehicle.canonical_body_style || vehicle.body_style || ''}
            variant="status"
          />
        )}
        {vehicle.transmission && (
          <BadgePortal
            dimension="transmission"
            value={vehicle.transmission}
            label={vehicle.transmission.toLowerCase().includes('manual') ? 'MANUAL' : 'AUTO'}
            variant="status"
          />
        )}
        {vehicle.deal_score_label && vehicle.deal_score_label !== 'fair' && (
          <BadgePortal
            dimension="deal_score"
            value={vehicle.deal_score_label}
            label={vehicle.deal_score_label.replace(/_/g, ' ').toUpperCase()}
            variant="deal"
          />
        )}
        {vehicle.discovery_source && (
          <BadgePortal
            dimension="source"
            value={vehicle.discovery_source}
            label={sourceLabel || vehicle.discovery_source.toUpperCase().slice(0, 12)}
            variant="source"
          />
        )}
      </div>
    </div>
  ), [vehicle, specEntries, alt, sourceLabel]);

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
  return (
    <CardShell
      vehicleId={vehicle.id}
      viewMode="grid"
      expandedContent={expandedContent}
      onHoverStart={onHoverStart}
      onHoverEnd={onHoverEnd}
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
