import React, { useState, useEffect, useRef } from 'react';
import { formatCurrencyAmount } from '../../utils/currency';
import { FaviconIcon } from '../common/FaviconIcon';
import {
  CompletenessPortal, YearPortal, MakePortal, ModelPortal, PricePortal,
  MileagePortal, ColorPortal, SourcePortal, TransmissionPortal,
} from './micro-portals';
import { useVehicleFollow } from '../../hooks/useVehicleFollow';

interface VehicleHoverCardProps {
  vehicle: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    series?: string;
    trim?: string;
    vin?: string;
    mileage?: number;
    sale_price?: number;
    current_value?: number;
    asking_price?: number;
    display_price?: number;
    sale_date?: string;
    auction_end_date?: string;
    sale_status?: string;
    auction_outcome?: string;
    location?: string;
    discovery_source?: string;
    discovery_url?: string;
    profile_origin?: string;
    updated_at?: string;
    created_at?: string;
    image_count?: number;
    event_count?: number;
    receipt_count?: number;
    transmission?: string;
    engine?: string;
    exterior_color?: string;
    // Valuation fields from vehicle_valuation_feed
    nuke_estimate?: number;
    nuke_estimate_confidence?: number;
    deal_score?: number;
    deal_score_label?: string;
    heat_score?: number;
    heat_score_label?: string;
    is_record_price?: boolean;
  };
  position: { x: number; y: number };
  onClose: () => void;
  onAction?: (action: 'follow' | 'details') => void;
  viewerUserId?: string;
}

const VehicleHoverCard: React.FC<VehicleHoverCardProps> = ({
  vehicle,
  position,
  onClose,
  onAction,
  viewerUserId,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [activePortal, setActivePortal] = useState<string | null>(null);
  const { isFollowing, isLoading: followLoading, toggleFollow } = useVehicleFollow(vehicle.id);

  // Adjust position to keep card in viewport
  useEffect(() => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = position.x;
    let y = position.y;

    // Keep card within viewport bounds
    if (x + rect.width > viewportWidth - 20) {
      x = position.x - rect.width - 20;
    }
    if (y + rect.height > viewportHeight - 20) {
      y = viewportHeight - rect.height - 20;
    }
    if (x < 20) x = 20;
    if (y < 20) y = 20;

    setAdjustedPosition({ x, y });
  }, [position]);

  // Format price with fallbacks
  const price = vehicle.sale_price || vehicle.current_value || vehicle.asking_price;
  const priceLabel = vehicle.sale_price ? 'Sold' : vehicle.asking_price ? 'Asking' : 'Est. Value';

  // Get status
  const getStatus = () => {
    if (vehicle.auction_outcome === 'sold' || vehicle.sale_status === 'sold') return { label: 'SOLD', color: 'var(--success)' };
    if (vehicle.auction_outcome === 'bid_to' || vehicle.sale_status === 'bid_to') return { label: 'BID TO', color: 'var(--warning)' };
    if (vehicle.auction_outcome === 'not_sold' || vehicle.sale_status === 'not_sold') return { label: 'NOT SOLD', color: 'var(--error)' };
    if (vehicle.sale_status === 'for_sale') return { label: 'FOR SALE', color: 'var(--accent)' };
    return null;
  };
  const status = getStatus();

  // Get source info
  const getSourceInfo = () => {
    const source = vehicle.discovery_source || vehicle.profile_origin;
    if (!source) return null;

    const sourceMap: Record<string, { name: string; color: string }> = {
      'bringatrailer': { name: 'BaT', color: 'var(--error)' },
      'bat_import': { name: 'BaT', color: 'var(--error)' },
      'carsandbids': { name: 'C&B', color: '#7c3aed' },
      'url_scraper': { name: 'Web', color: 'var(--text-secondary)' },
      'user_upload': { name: 'User', color: 'var(--accent)' },
    };

    const key = source.toLowerCase().replace(/[^a-z]/g, '');
    for (const [k, v] of Object.entries(sourceMap)) {
      if (key.includes(k.replace(/[^a-z]/g, ''))) return v;
    }
    return { name: source.slice(0, 8), color: 'var(--text-secondary)' };
  };
  const sourceInfo = getSourceInfo();

  // Format date
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
      return null;
    }
  };

  const saleDate = formatDate(vehicle.sale_date || vehicle.auction_end_date);
  const lastUpdated = formatDate(vehicle.updated_at);

  return (
    <div
      ref={cardRef}
      style={{
        position: 'fixed',
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        zIndex: 9999,
        background: 'var(--bg)',
        border: '1px solid var(--border)', padding: '12px',
        minWidth: '280px',
        maxWidth: '320px',
        fontSize: '12px',
        fontFamily: 'Arial, sans-serif',
        pointerEvents: 'auto',
        opacity: 1,
        transform: 'translateY(0)',
        transition: 'opacity 0.15s ease, transform 0.15s ease',
        animation: 'hoverCardAppear 0.15s ease',
      }}
      onMouseLeave={onClose}
    >
      {/* Header: Year Make Model — each token is a clickable portal */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
        <div style={{ fontWeight: 600, fontSize: '13px', lineHeight: 1.2 }}>
          {vehicle.year ? (
            <YearPortal year={vehicle.year} activePortal={activePortal} onOpen={setActivePortal} />
          ) : null}
          {vehicle.year && vehicle.make ? ' ' : ''}
          {vehicle.make ? (
            <MakePortal make={vehicle.make} activePortal={activePortal} onOpen={setActivePortal} />
          ) : null}
          {vehicle.make && vehicle.model ? ' ' : ''}
          {vehicle.model ? (
            <ModelPortal
              make={vehicle.make || ''}
              model={vehicle.model}
              vehiclePrice={price}
              activePortal={activePortal}
              onOpen={setActivePortal}
            />
          ) : null}
          {vehicle.series && <span style={{ fontWeight: 400, opacity: 0.7 }}> {vehicle.series}</span>}
        </div>
        {status && (
          <span style={{
            background: status.color,
            color: 'var(--bg)',
            padding: '2px 6px', fontSize: '9px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            {status.label}
          </span>
        )}
      </div>

      {/* Price row — PricePortal never shows "No price data" */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
        <PricePortal
          vehicle={vehicle as any}
          vehicleId={vehicle.id}
          userId={viewerUserId}
          activePortal={activePortal}
          onOpen={setActivePortal}
        />
        {priceLabel && price && (
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            {priceLabel}
          </span>
        )}
        {saleDate && (
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
            {saleDate}
          </span>
        )}
      </div>

      {/* Quick stats grid — each stat is a clickable portal */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        marginBottom: '10px',
        padding: '8px',
        background: 'var(--bg-secondary)', }}>
        <div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Miles</div>
          <div style={{ fontWeight: 600 }}>
            <MileagePortal
              vehicleId={vehicle.id}
              mileage={vehicle.mileage}
              year={vehicle.year}
              activePortal={activePortal}
              onOpen={setActivePortal}
            />
          </div>
        </div>
        <div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Trans</div>
          <div style={{ fontWeight: 600 }}>
            <TransmissionPortal
              transmission={vehicle.transmission}
              activePortal={activePortal}
              onOpen={setActivePortal}
            />
          </div>
        </div>
        <div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Color</div>
          <div style={{ fontWeight: 600 }}>
            <ColorPortal
              make={vehicle.make}
              color={vehicle.exterior_color}
              year={vehicle.year}
              activePortal={activePortal}
              onOpen={setActivePortal}
            />
          </div>
        </div>
      </div>

      {/* Source and data info */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {vehicle.discovery_url && (
            <FaviconIcon url={vehicle.discovery_url} size={14} />
          )}
          {sourceInfo && (
            <SourcePortal
              vehicleId={vehicle.id}
              platform={vehicle.discovery_source || vehicle.profile_origin || ''}
              platformDisplayName={sourceInfo.name}
              platformColor={sourceInfo.color}
              vehiclePrice={price}
              activePortal={activePortal}
              onOpen={setActivePortal}
            />
          )}
          {vehicle.location && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {vehicle.location.slice(0, 20)}
            </span>
          )}
        </div>

        {/* Data completeness indicator — click to see field breakdown */}
        <CompletenessPortal
          vehicle={vehicle as Record<string, any>}
          activePortal={activePortal}
          onOpen={setActivePortal}
        />
      </div>

      {/* Metrics row */}
      {(vehicle.image_count || vehicle.event_count || vehicle.receipt_count) && (
        <div style={{
          display: 'flex',
          gap: '12px',
          fontSize: '11px',
          color: 'var(--text-muted)',
          marginBottom: '10px',
        }}>
          {vehicle.image_count !== undefined && vehicle.image_count > 0 && (
            <span>{vehicle.image_count} images</span>
          )}
          {vehicle.event_count !== undefined && vehicle.event_count > 0 && (
            <span>{vehicle.event_count} events</span>
          )}
          {vehicle.receipt_count !== undefined && vehicle.receipt_count > 0 && (
            <span>{vehicle.receipt_count} receipts</span>
          )}
        </div>
      )}

      {/* AI Insights section */}
      {(vehicle.deal_score || vehicle.heat_score || vehicle.nuke_estimate || vehicle.is_record_price) && (
        <div style={{
          padding: '8px',
          marginBottom: '10px',
          background: 'var(--grey-50)',
          border: '1px solid var(--border)', fontSize: '11px',
        }}>
          <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
            AI Take
          </div>

          {/* Deal verdict */}
          {vehicle.deal_score != null && vehicle.nuke_estimate != null && price != null && price > 0 && (
            <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '6px',
                height: '6px', background: vehicle.deal_score > 20 ? 'var(--success)' : vehicle.deal_score > 0 ? 'var(--success)' : vehicle.deal_score > -20 ? 'var(--warning)' : 'var(--error)',
                flexShrink: 0,
              }} />
              <span style={{ color: 'var(--text)' }}>
                {vehicle.deal_score > 20
                  ? `Good deal \u2014 ${Math.round(((vehicle.nuke_estimate - price) / vehicle.nuke_estimate) * 100)}% below market`
                  : vehicle.deal_score > 0
                  ? `Fair price \u2014 near market value`
                  : vehicle.deal_score > -20
                  ? `Slightly above market`
                  : `Overpriced \u2014 ${Math.round(((price - vehicle.nuke_estimate) / vehicle.nuke_estimate) * 100)}% above estimate`
                }
              </span>
            </div>
          )}

          {/* Heat indicator */}
          {vehicle.heat_score != null && (
            <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: '40px',
                height: '4px',
                background: 'var(--border)', overflow: 'hidden',
                flexShrink: 0,
              }}>
                <div style={{
                  width: `${Math.min(100, Math.max(5, vehicle.heat_score))}%`,
                  height: '100%',
                  background: vehicle.heat_score > 70 ? 'var(--error)' : vehicle.heat_score > 40 ? 'var(--warning)' : 'var(--text-secondary)',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{ color: 'var(--text-muted)' }}>
                {vehicle.heat_score > 70 ? 'Hot' : vehicle.heat_score > 40 ? 'Warm' : 'Low interest'}
              </span>
            </div>
          )}

          {/* Record price badge */}
          {vehicle.is_record_price && (
            <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                background: 'var(--warning)',
                color: 'var(--text)',
                padding: '1px 6px', fontSize: '9px',
                fontWeight: 600,
              }}>
                RECORD
              </span>
              <span style={{ color: 'var(--text-muted)' }}>Record price for this model</span>
            </div>
          )}

          {/* Nuke estimate */}
          {vehicle.nuke_estimate != null && vehicle.nuke_estimate > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                {formatCurrencyAmount(vehicle.nuke_estimate)}
              </span>
              <span style={{ fontSize: '9px' }}>
                Nuke estimate
                {vehicle.nuke_estimate_confidence != null && (
                  <> ({vehicle.nuke_estimate_confidence}% conf)</>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction?.('details'); }}
          style={{
            flex: 1,
            padding: '6px 10px',
            background: 'var(--primary)',
            color: 'var(--bg)',
            border: 'none', fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          View Details
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (viewerUserId) {
              toggleFollow();
            } else {
              onAction?.('follow');
            }
          }}
          disabled={followLoading}
          style={{
            padding: '6px 10px',
            background: isFollowing ? 'var(--primary)' : 'var(--bg-secondary)',
            color: isFollowing ? 'var(--bg)' : 'var(--text)',
            border: isFollowing ? 'none' : '1px solid var(--border)', fontSize: '11px',
            cursor: followLoading ? 'wait' : 'pointer',
            opacity: followLoading ? 0.6 : 1,
            transition: 'all 0.15s ease',
          }}
        >
          {followLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
        </button>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'right' }}>
          Updated {lastUpdated}
        </div>
      )}
    </div>
  );
};

export default VehicleHoverCard;
