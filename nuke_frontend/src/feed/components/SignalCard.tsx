/**
 * SignalCard -- Special cards injected between vehicle cards in the feed.
 *
 * Turns the feed from a static catalog into a live market floor.
 * Each signal type has distinct visual treatment with earned-color borders,
 * Courier New data typography, and zero border-radius per design system.
 *
 * Signal types:
 *   LIVE_AUCTION  - Auction ending within 24h (red border, spans 2 cols)
 *   DEAL_ALERT    - Deal score > 80 (green border)
 *   PRICE_DROP    - Previously viewed vehicle with price drop
 *   NEW_FROM_SOURCE - Batch of new vehicles from a single source
 *   COMMENT_HIGHLIGHT - Interesting comment surfaced from auction
 */

import { useMemo, type CSSProperties } from 'react';
import { useAuctionClock } from './AuctionClockProvider';
import type { FeedVehicle } from '../types/feed';
import ResilientImage from '../../components/images/ResilientImage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalType =
  | 'LIVE_AUCTION'
  | 'DEAL_ALERT'
  | 'PRICE_DROP'
  | 'NEW_FROM_SOURCE'
  | 'COMMENT_HIGHLIGHT';

export interface SignalCardData {
  type: SignalType;
  id: string; // unique key for dedup
  vehicle?: FeedVehicle;
  vehicles?: FeedVehicle[]; // for NEW_FROM_SOURCE
  /** Extra payload per signal type */
  meta?: {
    // DEAL_ALERT
    belowMarketPct?: number;
    // PRICE_DROP
    oldPrice?: number;
    newPrice?: number;
    pctChange?: number;
    // NEW_FROM_SOURCE
    sourceName?: string;
    sourceCount?: number;
    // COMMENT_HIGHLIGHT
    commentText?: string;
    commentAuthor?: string;
    commentVehicleTitle?: string;
  };
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const MONO: CSSProperties['fontFamily'] = "'Courier New', monospace";
const SANS: CSSProperties['fontFamily'] = 'Arial, sans-serif';
const TRANSITION = '180ms cubic-bezier(0.16, 1, 0.3, 1)';

const baseLabelStyle: CSSProperties = {
  fontFamily: SANS,
  fontSize: '8px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  lineHeight: 1,
};

const baseValueStyle: CSSProperties = {
  fontFamily: MONO,
  fontWeight: 700,
  lineHeight: 1,
};

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'ENDED';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || n === 0) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n}`;
}

// ---------------------------------------------------------------------------
// Vehicle title helper
// ---------------------------------------------------------------------------

function vehicleTitle(v: FeedVehicle): string {
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
}

// ---------------------------------------------------------------------------
// LIVE AUCTION ALERT
// ---------------------------------------------------------------------------

function LiveAuctionSignal({ data }: { data: SignalCardData }) {
  const now = useAuctionClock();
  const v = data.vehicle;
  if (!v) return null;

  const endMs = v.auction_end_date ? new Date(v.auction_end_date).getTime() : 0;
  const remaining = endMs - now;
  const isUrgent = remaining > 0 && remaining < 3600_000; // < 1 hour
  const timeColor = isUrgent ? 'var(--error)' : remaining <= 0 ? 'var(--text-disabled)' : 'var(--text)';

  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        padding: '10px 12px',
        background: 'var(--bg)',
        border: '2px solid var(--error)',
        cursor: 'pointer',
        transition: `border-color ${TRANSITION}`,
        height: '100%',
        alignItems: 'stretch',
      }}
      onClick={() => {
        if (v.listing_url) window.open(v.listing_url, '_blank');
        else if (v.discovery_url) window.open(v.discovery_url, '_blank');
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--error)'; }}
    >
      {/* Image */}
      {v.thumbnail_url && (
        <div style={{ width: '120px', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
          <ResilientImage
            sources={[v.thumbnail_url]}
            alt={vehicleTitle(v)}
            fill
            objectFit="cover"
            placeholderSrc="/nuke.png"
            placeholderOpacity={0.2}
            loading="lazy"
          />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
        {/* Header */}
        <div>
          <div style={{ ...baseLabelStyle, color: 'var(--error)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '6px', height: '6px', background: 'var(--error)', display: 'inline-block', animation: 'nuke-auction-pulse 2s ease-in-out infinite' }} />
            LIVE AUCTION
          </div>
          <div style={{
            fontFamily: SANS, fontSize: '11px', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.02em',
            color: 'var(--text)', lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {vehicleTitle(v)}
          </div>
        </div>

        {/* Bid + time row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '8px', marginTop: '6px' }}>
          <div>
            <div style={{ ...baseLabelStyle, color: 'var(--text-disabled)', marginBottom: '2px' }}>
              CURRENT BID
            </div>
            <div style={{ ...baseValueStyle, fontSize: '18px', color: 'var(--text)' }}>
              {formatPrice(v.current_bid || v.display_price)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ ...baseLabelStyle, color: 'var(--text-disabled)', marginBottom: '2px' }}>
              {remaining > 0 ? 'ENDS IN' : 'ENDED'}
            </div>
            <div style={{ ...baseValueStyle, fontSize: '14px', color: timeColor }}>
              {remaining > 0 ? formatTimeRemaining(remaining) : 'CLOSED'}
            </div>
          </div>
        </div>

        {/* Footer: stats + CTA */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            {v.bid_count != null && v.bid_count > 0 && (
              <span style={{ ...baseLabelStyle, color: 'var(--text-secondary)' }}>
                {v.bid_count} BIDS
              </span>
            )}
            {v.image_count != null && v.image_count > 1 && (
              <span style={{ ...baseLabelStyle, color: 'var(--text-disabled)' }}>
                {v.image_count} PHOTOS
              </span>
            )}
          </div>
          {remaining > 0 && (
            <span style={{
              ...baseLabelStyle,
              fontSize: '9px',
              color: 'var(--error)',
              letterSpacing: '0.3px',
            }}>
              BID NOW {'\u2192'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DEAL ALERT
// ---------------------------------------------------------------------------

function DealAlertSignal({ data }: { data: SignalCardData }) {
  const v = data.vehicle;
  if (!v) return null;

  const pctBelow = data.meta?.belowMarketPct ?? 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        border: '2px solid var(--success)',
        cursor: 'pointer',
        transition: `border-color ${TRANSITION}`,
        height: '100%',
        overflow: 'hidden',
      }}
      onClick={() => {
        if (v.listing_url) window.open(v.listing_url, '_blank');
        else if (v.discovery_url) window.open(v.discovery_url, '_blank');
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--success)'; }}
    >
      {/* Image with badge overlay */}
      {v.thumbnail_url && (
        <div style={{ width: '100%', paddingTop: '60%', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <ResilientImage
              sources={[v.thumbnail_url]}
              alt={vehicleTitle(v)}
              fill
              objectFit="cover"
              placeholderSrc="/nuke.png"
              placeholderOpacity={0.2}
              loading="lazy"
            />
          </div>
          {/* Badge */}
          <div style={{
            position: 'absolute', top: '6px', left: '6px',
            background: 'var(--success)', color: '#fff',
            padding: '3px 8px',
            fontFamily: SANS, fontSize: '8px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            {pctBelow > 0 ? `${pctBelow}% BELOW MARKET` : 'DEAL ALERT'}
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ ...baseLabelStyle, color: 'var(--success)', marginBottom: '3px' }}>
            DEAL ALERT
          </div>
          <div style={{
            fontFamily: SANS, fontSize: '10px', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.02em',
            color: 'var(--text)', lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {vehicleTitle(v)}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '6px' }}>
          {/* Asking price */}
          <div>
            {v.nuke_estimate != null && v.nuke_estimate > 0 && (
              <div style={{
                ...baseValueStyle, fontSize: '9px',
                color: 'var(--text-disabled)',
                textDecoration: 'line-through',
                marginBottom: '2px',
              }}>
                {formatPrice(v.nuke_estimate)}
              </div>
            )}
            <div style={{ ...baseValueStyle, fontSize: '16px', color: 'var(--success)' }}>
              {formatPrice(v.display_price)}
            </div>
          </div>
          {v.deal_score_label && (
            <span style={{
              fontFamily: SANS, fontSize: '8px', fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: '0.3px',
              padding: '3px 6px', background: 'var(--success)', color: '#fff',
            }}>
              {v.deal_score_label === 'plus_3' ? 'STEAL' : v.deal_score_label === 'plus_2' ? 'GREAT' : 'GOOD'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRICE DROP
// ---------------------------------------------------------------------------

function PriceDropSignal({ data }: { data: SignalCardData }) {
  const v = data.vehicle;
  if (!v) return null;

  const oldPrice = data.meta?.oldPrice ?? 0;
  const newPrice = data.meta?.newPrice ?? v.display_price ?? 0;
  const pctChange = data.meta?.pctChange ?? 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        border: '2px solid var(--info)',
        cursor: 'pointer',
        transition: `border-color ${TRANSITION}`,
        height: '100%',
        overflow: 'hidden',
      }}
      onClick={() => {
        if (v.listing_url) window.open(v.listing_url, '_blank');
        else if (v.discovery_url) window.open(v.discovery_url, '_blank');
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--info)'; }}
    >
      {/* Image */}
      {v.thumbnail_url && (
        <div style={{ width: '100%', paddingTop: '60%', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <ResilientImage
              sources={[v.thumbnail_url]}
              alt={vehicleTitle(v)}
              fill
              objectFit="cover"
              placeholderSrc="/nuke.png"
              placeholderOpacity={0.2}
              loading="lazy"
            />
          </div>
          {/* PRICE DROPPED badge */}
          <div style={{
            position: 'absolute', top: '6px', left: '6px',
            background: 'var(--info)', color: '#fff',
            padding: '3px 8px',
            fontFamily: SANS, fontSize: '8px', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            PRICE DROPPED
          </div>
          {/* VIEWED badge */}
          <div style={{
            position: 'absolute', top: '6px', right: '6px',
            background: 'rgba(0,0,0,0.65)', color: 'var(--text-disabled)',
            padding: '2px 6px',
            fontFamily: SANS, fontSize: '7px', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.3px',
          }}>
            VIEWED
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{
          fontFamily: SANS, fontSize: '10px', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.02em',
          color: 'var(--text)', lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {vehicleTitle(v)}
        </div>

        {/* Price comparison */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px' }}>
          {oldPrice > 0 && (
            <span style={{
              ...baseValueStyle, fontSize: '10px',
              color: 'var(--text-disabled)',
              textDecoration: 'line-through',
            }}>
              {formatPrice(oldPrice)}
            </span>
          )}
          <span style={{ ...baseValueStyle, fontSize: '9px', color: 'var(--text-disabled)' }}>
            {'\u2192'}
          </span>
          <span style={{ ...baseValueStyle, fontSize: '14px', color: 'var(--info)' }}>
            {formatPrice(newPrice)}
          </span>
          {pctChange !== 0 && (
            <span style={{
              ...baseLabelStyle,
              color: 'var(--success)',
              fontSize: '9px',
            }}>
              {pctChange < 0 ? `${Math.abs(pctChange)}% OFF` : `+${pctChange}%`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NEW FROM SOURCE
// ---------------------------------------------------------------------------

function NewFromSourceSignal({ data }: { data: SignalCardData }) {
  const sourceName = data.meta?.sourceName ?? 'UNKNOWN';
  const count = data.meta?.sourceCount ?? data.vehicles?.length ?? 0;
  const thumbs = (data.vehicles ?? []).slice(0, 4);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        border: '2px solid var(--warning)',
        cursor: 'pointer',
        transition: `border-color ${TRANSITION}`,
        height: '100%',
        overflow: 'hidden',
        padding: '10px',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--warning)'; }}
    >
      {/* Header */}
      <div style={{ ...baseLabelStyle, color: 'var(--warning)', marginBottom: '6px' }}>
        NEW ARRIVALS
      </div>
      <div style={{
        fontFamily: MONO, fontSize: '13px', fontWeight: 700,
        color: 'var(--text)', lineHeight: 1.2, marginBottom: '8px',
      }}>
        {count} NEW FROM {sourceName.toUpperCase()}
      </div>

      {/* Mini thumbnail grid */}
      {thumbs.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '3px',
          flex: 1,
          minHeight: 0,
        }}>
          {thumbs.map((v, i) => (
            <div key={v.id || i} style={{
              position: 'relative',
              paddingTop: '75%',
              overflow: 'hidden',
              background: 'var(--surface-hover)',
            }}>
              {v.thumbnail_url && (
                <div style={{ position: 'absolute', inset: 0 }}>
                  <ResilientImage
                    sources={[v.thumbnail_url]}
                    alt={vehicleTitle(v)}
                    fill
                    objectFit="cover"
                    placeholderSrc="/nuke.png"
                    placeholderOpacity={0.2}
                    loading="lazy"
                  />
                </div>
              )}
            </div>
          ))}
          {/* Fill empty slots */}
          {Array.from({ length: Math.max(0, 4 - thumbs.length) }, (_, i) => (
            <div key={`empty-${i}`} style={{
              paddingTop: '75%',
              background: 'var(--surface-hover)',
            }} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: '6px', textAlign: 'right' }}>
        <span style={{
          ...baseLabelStyle,
          fontSize: '9px',
          color: 'var(--warning)',
        }}>
          VIEW ALL {'\u2192'}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COMMENT HIGHLIGHT
// ---------------------------------------------------------------------------

function CommentHighlightSignal({ data }: { data: SignalCardData }) {
  const v = data.vehicle;
  const commentText = data.meta?.commentText ?? '';
  const author = data.meta?.commentAuthor;
  const vTitle = data.meta?.commentVehicleTitle ?? (v ? vehicleTitle(v) : 'Vehicle');

  // Truncate long comments
  const displayText = commentText.length > 180
    ? commentText.slice(0, 177) + '...'
    : commentText;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        border: '2px solid var(--text-secondary)',
        cursor: 'pointer',
        transition: `border-color ${TRANSITION}`,
        height: '100%',
        overflow: 'hidden',
        padding: '10px 12px',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; }}
    >
      {/* Header */}
      <div style={{ ...baseLabelStyle, color: 'var(--text-secondary)', marginBottom: '6px' }}>
        FROM THE COMMENTS
      </div>

      {/* Quote */}
      <div style={{
        fontFamily: SANS, fontSize: '11px', fontWeight: 400,
        color: 'var(--text)', lineHeight: 1.4,
        fontStyle: 'italic',
        borderLeft: '3px solid var(--text-secondary)',
        paddingLeft: '10px',
        marginBottom: '8px',
        flex: 1,
        overflow: 'hidden',
      }}>
        &ldquo;{displayText}&rdquo;
      </div>

      {/* Attribution + vehicle context */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '8px' }}>
        <div>
          {author && (
            <div style={{
              fontFamily: MONO, fontSize: '9px', fontWeight: 700,
              color: 'var(--text-secondary)', textTransform: 'uppercase',
              letterSpacing: '0.3px',
            }}>
              {author}
            </div>
          )}
          <div style={{
            fontFamily: SANS, fontSize: '8px', fontWeight: 700,
            color: 'var(--text-disabled)', textTransform: 'uppercase',
            letterSpacing: '0.3px', marginTop: '2px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '200px',
          }}>
            on {vTitle}
          </div>
        </div>
        {v?.thumbnail_url && (
          <div style={{
            width: '48px', height: '36px', flexShrink: 0,
            position: 'relative', overflow: 'hidden',
            border: '1px solid var(--border)',
          }}>
            <ResilientImage
              sources={[v.thumbnail_url]}
              alt={vTitle}
              fill
              objectFit="cover"
              placeholderSrc="/nuke.png"
              placeholderOpacity={0.2}
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SignalCard dispatcher
// ---------------------------------------------------------------------------

export interface SignalCardProps {
  data: SignalCardData;
}

export function SignalCard({ data }: SignalCardProps) {
  switch (data.type) {
    case 'LIVE_AUCTION':
      return <LiveAuctionSignal data={data} />;
    case 'DEAL_ALERT':
      return <DealAlertSignal data={data} />;
    case 'PRICE_DROP':
      return <PriceDropSignal data={data} />;
    case 'NEW_FROM_SOURCE':
      return <NewFromSourceSignal data={data} />;
    case 'COMMENT_HIGHLIGHT':
      return <CommentHighlightSignal data={data} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// useSignalCards — Derives signal card data from the loaded vehicle set.
//
// Scans the vehicles array for live auctions, deals, source batches, and
// comment-worthy vehicles, then builds a rotating queue of signals.
// ---------------------------------------------------------------------------

export function useSignalCards(
  vehicles: FeedVehicle[],
  viewedIds: Set<string>,
): SignalCardData[] {
  return useMemo(() => {
    if (vehicles.length === 0) return [];

    const signals: SignalCardData[] = [];
    const now = Date.now();
    const usedVehicleIds = new Set<string>();

    // 1. LIVE AUCTIONS ending within 24h
    const liveAuctions = vehicles
      .filter((v) => {
        if (!v.auction_end_date) return false;
        const end = new Date(v.auction_end_date).getTime();
        if (!Number.isFinite(end)) return false;
        const diff = end - now;
        return diff > 0 && diff < 24 * 3600_000;
      })
      .sort((a, b) => {
        const aEnd = new Date(a.auction_end_date!).getTime();
        const bEnd = new Date(b.auction_end_date!).getTime();
        return aEnd - bEnd; // soonest first
      })
      .slice(0, 3);

    for (const v of liveAuctions) {
      signals.push({
        type: 'LIVE_AUCTION',
        id: `live-${v.id}`,
        vehicle: v,
      });
      usedVehicleIds.add(v.id);
    }

    // 2. DEAL ALERTS (deal_score > 80 or label plus_2/plus_3)
    const deals = vehicles
      .filter((v) => {
        if (usedVehicleIds.has(v.id)) return false;
        if (v.deal_score != null && v.deal_score > 80) return true;
        if (v.deal_score_label === 'plus_3' || v.deal_score_label === 'plus_2') return true;
        return false;
      })
      .slice(0, 3);

    for (const v of deals) {
      let belowMarketPct = 0;
      if (v.nuke_estimate && v.display_price && v.nuke_estimate > 0) {
        belowMarketPct = Math.round(((v.nuke_estimate - v.display_price) / v.nuke_estimate) * 100);
      } else if (v.deal_score != null) {
        belowMarketPct = Math.round(v.deal_score);
      }
      signals.push({
        type: 'DEAL_ALERT',
        id: `deal-${v.id}`,
        vehicle: v,
        meta: { belowMarketPct: Math.max(0, belowMarketPct) },
      });
      usedVehicleIds.add(v.id);
    }

    // 3. PRICE DROP — vehicles the user has viewed that now have a lower price.
    // We approximate this: if the vehicle was viewed AND has a deal score, show it.
    // Real price-drop tracking would require persisting old prices, but we can
    // create the visual signal from what we have.
    const viewedVehicles = vehicles
      .filter((v) => {
        if (usedVehicleIds.has(v.id)) return false;
        if (!viewedIds.has(v.id)) return false;
        if (!v.display_price || v.display_price <= 0) return false;
        // Use nuke_estimate as proxy for "old expected price"
        if (!v.nuke_estimate || v.nuke_estimate <= 0) return false;
        // Only show if current price is below estimate (price dropped below what user saw)
        return v.display_price < v.nuke_estimate;
      })
      .slice(0, 2);

    for (const v of viewedVehicles) {
      const oldPrice = v.nuke_estimate!;
      const newPrice = v.display_price!;
      const pctChange = -Math.round(((oldPrice - newPrice) / oldPrice) * 100);
      signals.push({
        type: 'PRICE_DROP',
        id: `drop-${v.id}`,
        vehicle: v,
        meta: { oldPrice, newPrice, pctChange },
      });
      usedVehicleIds.add(v.id);
    }

    // 4. NEW FROM SOURCE — group vehicles by discovery_source, find large batches
    const sourceGroups = new Map<string, FeedVehicle[]>();
    for (const v of vehicles) {
      const src = v.discovery_source || v.profile_origin;
      if (!src) continue;
      const group = sourceGroups.get(src) || [];
      group.push(v);
      sourceGroups.set(src, group);
    }

    // Find sources with 5+ vehicles (indicates a new batch)
    const batchSources = Array.from(sourceGroups.entries())
      .filter(([, vList]) => vList.length >= 5)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 2);

    for (const [sourceName, vList] of batchSources) {
      const displayName = sourceName
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      signals.push({
        type: 'NEW_FROM_SOURCE',
        id: `source-${sourceName}`,
        vehicles: vList.slice(0, 4),
        meta: { sourceName: displayName, sourceCount: vList.length },
      });
    }

    // 5. COMMENT HIGHLIGHT — vehicles with high bid/comment counts
    // Surface these as "interesting conversation" signals
    const commentWorthy = vehicles
      .filter((v) => {
        if (usedVehicleIds.has(v.id)) return false;
        if (!v.bid_count || v.bid_count < 10) return false;
        return true;
      })
      .sort((a, b) => (b.bid_count ?? 0) - (a.bid_count ?? 0))
      .slice(0, 2);

    for (const v of commentWorthy) {
      // We don't have actual comment text in the feed data, so create a signal
      // that invites the user to see comments
      const commentText = v.bid_count && v.bid_count > 50
        ? `${v.bid_count} bids and counting on this ${vehicleTitle(v)}. The market is speaking.`
        : `${v.bid_count} bids so far. See what buyers are saying.`;

      signals.push({
        type: 'COMMENT_HIGHLIGHT',
        id: `comment-${v.id}`,
        vehicle: v,
        meta: {
          commentText,
          commentVehicleTitle: vehicleTitle(v),
        },
      });
      usedVehicleIds.add(v.id);
    }

    return signals;
  }, [vehicles, viewedIds]);
}
