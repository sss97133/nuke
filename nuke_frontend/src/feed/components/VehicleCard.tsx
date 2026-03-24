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
import { CardPrice } from './card/CardPrice';
import { CardMeta } from './card/CardMeta';
import { CardDealScore } from './card/CardDealScore';
import { CardSource, resolveSourceLabel } from './card/CardSource';
import { CardAuctionTimer } from './card/CardAuctionTimer';
import { CardActions } from './card/CardActions';
import { CardTier } from './card/CardTier';
import { CardRankScore } from './card/CardRankScore';
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

  // Expanded content for grid cards — BadgePortals for every dimension
  const expandedContent = useMemo(() => (
    <div>
      {/* Badge portal row — explore by dimension */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        marginBottom: '8px',
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

      {/* Specs row */}
      <div style={{
        display: 'flex',
        gap: '12px',
        fontFamily: "'Courier New', monospace",
        fontSize: '9px',
        color: 'var(--text-secondary)',
        marginBottom: '8px',
      }}>
        {vehicle.mileage ? <span>{Math.floor(vehicle.mileage).toLocaleString()} MI</span> : null}
        {vehicle.drivetrain ? <span>{vehicle.drivetrain.toUpperCase()}</span> : null}
        {vehicle.vin ? <span>VIN: ...{vehicle.vin.slice(-6)}</span> : null}
      </div>
    </div>
  ), [vehicle]);

  // Grid mode (default) — richer than v1
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
        {showScores && <CardRankScore vehicle={vehicle} compact={compact} />}
        <CardPrice price={price} compact={compact} />
        {/* Top-left: source badge + live timer stacked */}
        <div style={{
          position: 'absolute',
          top: '6px',
          left: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
          zIndex: 10,
          pointerEvents: 'none',
        }}>
          <CardSource
            discoveryUrl={vehicle.discovery_url}
            discoverySource={vehicle.discovery_source}
            profileOrigin={vehicle.profile_origin}
          />
          {price.isLive && vehicle.auction_end_date && (
            <CardAuctionTimer endDate={vehicle.auction_end_date} isLive />
          )}
        </div>
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

      {/* Source + Status line */}
      {(sourceLabel || price.isSold || price.isLive || vehicle.is_for_sale) && (
        <div style={{
          padding: compact ? '0 4px 2px' : '0 8px 2px',
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
        }}>
          {sourceLabel && (
            <span style={{
              fontFamily: "'Courier New', monospace",
              fontSize: '8px',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.5px',
              color: 'var(--text-tertiary, var(--text-secondary))',
              lineHeight: 1,
            }}>
              {sourceLabel}
            </span>
          )}
          {sourceLabel && (price.isSold || price.isLive || vehicle.is_for_sale) && (
            <span style={{
              fontFamily: "'Courier New', monospace",
              fontSize: '8px',
              color: 'var(--text-disabled)',
              lineHeight: 1,
            }}>
              /
            </span>
          )}
          {price.isLive && (
            <span style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '8px',
              fontWeight: 800,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.3px',
              color: 'var(--info)',
              lineHeight: 1,
            }}>
              LIVE
            </span>
          )}
          {price.isSold && price.showSoldBadge && !price.isLive && (
            <span style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '8px',
              fontWeight: 800,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.3px',
              color: 'var(--success)',
              lineHeight: 1,
            }}>
              SOLD
            </span>
          )}
          {vehicle.is_for_sale && !price.isSold && !price.isLive && (
            <span style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '8px',
              fontWeight: 800,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.3px',
              color: 'var(--info)',
              lineHeight: 1,
            }}>
              FOR SALE
            </span>
          )}
        </div>
      )}

      <CardMeta
        mileage={vehicle.mileage}
        transmission={vehicle.transmission}
        drivetrain={vehicle.drivetrain}
        bodyStyle={compact ? undefined : (vehicle.canonical_body_style || vehicle.body_style)}
        timeLabel={timeLabel}
        compact={compact}
      />

      {!compact && vehicle.deal_score_label && (
        <CardDealScore
          dealScoreLabel={vehicle.deal_score_label}
          heatScoreLabel={vehicle.heat_score_label}
        />
      )}

      {!compact && vehicle.data_completeness_tier && (
        <div style={{ padding: '0 8px 4px' }}>
          <CardTier tier={vehicle.data_completeness_tier} />
        </div>
      )}
    </CardShell>
  );
}
