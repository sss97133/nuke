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
import { CardSource } from './card/CardSource';
import { CardAuctionTimer } from './card/CardAuctionTimer';
import { CardActions } from './card/CardActions';
import { CardTier } from './card/CardTier';
import { CardRankScore } from './card/CardRankScore';

export interface VehicleCardProps {
  vehicle: FeedVehicle;
  viewMode: FeedViewConfig['viewMode'];
  compact?: boolean;
  showActions?: boolean;
  showScores?: boolean;
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
  isFollowing = false,
  isFollowLoading = false,
  onToggleFollow,
  onHoverStart,
  onHoverEnd,
  style,
}: VehicleCardProps) {
  const price = useMemo(() => resolveVehiclePrice(vehicle), [vehicle]);
  const timeLabel = useMemo(() => vehicleTimeLabel(vehicle), [vehicle]);

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
    // Table row — rendered by FeedLayout grid, shell uses display:contents
    return (
      <CardShell vehicleId={vehicle.id} viewMode="technical" style={style}>
        <CardImage thumbnailUrl={vehicle.thumbnail_url} alt={alt} viewMode="technical" />
        <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size, 10px)' }}>
          {vehicle.year ?? '—'}
        </span>
        <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size, 10px)' }}>
          {vehicle.make ?? '—'}
        </span>
        <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size, 10px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vehicle.model ?? '—'}
        </span>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 'var(--feed-font-size, 10px)', textAlign: 'right' }}>
          {vehicle.mileage ? `${Math.floor(vehicle.mileage).toLocaleString()}` : '—'}
        </span>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 'var(--feed-font-size, 10px)', textAlign: 'right', fontWeight: 700 }}>
          {price.formatted}
        </span>
        <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size-sm, 8px)', color: 'var(--text-secondary)' }}>
          {vehicle.canonical_body_style || '—'}
        </span>
        <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size-sm, 8px)', color: 'var(--text-secondary)' }}>
          {vehicle.transmission ? (vehicle.transmission.toLowerCase().includes('manual') ? 'MAN' : 'AUTO') : '—'}
        </span>
        {/* Deal column — inline pill, no wrapper padding */}
        {vehicle.deal_score_label && vehicle.deal_score_label !== 'fair' ? (
          <span style={{
            fontSize: 'var(--feed-font-size-xs, 7px)', fontWeight: 800,
            fontFamily: 'Arial, sans-serif', textTransform: 'uppercase',
            padding: '1px 3px', lineHeight: 1.4,
            color: vehicle.deal_score_label.startsWith('plus') ? '#fff' : vehicle.deal_score_label.startsWith('minus') ? '#fff' : 'var(--text-secondary)',
            background: vehicle.deal_score_label === 'plus_3' || vehicle.deal_score_label === 'plus_2' ? '#16825d'
              : vehicle.deal_score_label === 'plus_1' ? '#2d9d78'
              : vehicle.deal_score_label === 'minus_2' || vehicle.deal_score_label === 'minus_3' ? '#d13438'
              : vehicle.deal_score_label === 'minus_1' ? '#b05a00'
              : 'transparent',
          }}>
            {vehicle.deal_score_label === 'plus_3' ? 'STEAL'
              : vehicle.deal_score_label === 'plus_2' ? 'GREAT'
              : vehicle.deal_score_label === 'plus_1' ? 'GOOD'
              : vehicle.deal_score_label === 'minus_1' ? 'ABOVE'
              : vehicle.deal_score_label === 'minus_2' ? 'OVER'
              : vehicle.deal_score_label === 'minus_3' ? 'WAY+'
              : '—'}
          </span>
        ) : <span />}
        {/* Heat column */}
        {vehicle.heat_score_label && vehicle.heat_score_label !== 'cold' ? (
          <span style={{
            fontSize: 'var(--feed-font-size-xs, 7px)', fontWeight: 800,
            fontFamily: 'Arial, sans-serif', textTransform: 'uppercase',
            color: vehicle.heat_score_label === 'volcanic' ? '#d13438'
              : vehicle.heat_score_label === 'fire' ? '#ef4444'
              : vehicle.heat_score_label === 'hot' ? '#f59e0b'
              : vehicle.heat_score_label === 'warm' ? '#b05a00'
              : 'var(--text-disabled)',
          }}>
            {vehicle.heat_score_label.toUpperCase()}
          </span>
        ) : <span />}
        {/* Time column */}
        <span style={{
          fontFamily: "'Courier New', monospace", fontSize: 'var(--feed-font-size-sm, 8px)',
          color: timeLabel?.startsWith('sold') ? '#10b981'
            : timeLabel?.startsWith('ends') ? '#ef4444'
            : 'var(--text-disabled)',
          textAlign: 'right',
        }}>
          {timeLabel || '—'}
        </span>
        {/* Rank score column (only when showScores is on) */}
        {showScores && (
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 'var(--feed-font-size-sm, 8px)',
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
                  color: '#3b82f6', letterSpacing: '0.3px',
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
          {/* Row 2: meta + chips + deal + time */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', paddingLeft: '4px', flexWrap: 'wrap' }}>
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
                color: timeLabel.startsWith('sold') ? '#10b981'
                  : timeLabel.startsWith('ends') ? '#ef4444'
                  : timeLabel.startsWith('listed') ? '#3b82f6'
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

  // Grid mode (default) — richer than v1
  return (
    <CardShell
      vehicleId={vehicle.id}
      viewMode="grid"
      onHoverStart={onHoverStart}
      onHoverEnd={onHoverEnd}
      style={style}
    >
      <CardImage thumbnailUrl={vehicle.thumbnail_url} alt={alt} viewMode="grid" noImageData={noImageData}>
        {showScores && <CardRankScore vehicle={vehicle} compact={compact} />}
        <CardPrice price={price} compact={compact} />
        {price.isLive && vehicle.auction_end_date && (
          <CardAuctionTimer endDate={vehicle.auction_end_date} isLive />
        )}
        <CardSource discoveryUrl={vehicle.discovery_url} discoverySource={vehicle.discovery_source} />
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
