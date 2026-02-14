import React, { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import VehicleCardDense from '../vehicles/VehicleCardDense';
import VehicleHoverCard from '../vehicles/VehicleHoverCard';

/**
 * FeedGrid — Vehicle card grid with hover intelligence.
 *
 * Renders the CSS grid of VehicleCardDense cards with:
 * - Hover card (200ms delay) showing AI insights
 * - Mobile long-press support
 * - Infinite scroll sentinel
 * - Show more pagination
 *
 * Extracted from CursorHomepage.tsx lines ~7620-7694.
 */

export interface FeedGridProps {
  vehiclesToRender: any[];
  filteredVehicles: any[];
  feedVehicles: any[];
  viewMode: 'grid' | 'gallery' | 'technical';
  cardsPerRow: number;
  gridCardSizePx: number;
  thumbFitMode: 'square' | 'original';
  thermalPricing: boolean;
  infoDense: boolean;
  session: any;
  orgWebsitesById: Record<string, { website: string }>;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  isRenderTruncated: boolean;
  filteredRenderLimit: number;
  setFilteredRenderLimit: (fn: (prev: number) => number) => void;
  FILTERED_RENDER_STEP: number;
  // Sorting (for technical view)
  sortBy: string;
  setSortBy: (s: string) => void;
  sortDirection: string;
  setSortDirection: (d: string) => void;
  // Refs
  gridRef: React.RefObject<HTMLDivElement | null>;
  infiniteSentinelRef: React.RefObject<HTMLDivElement | null>;
}

const FeedGrid: React.FC<FeedGridProps> = ({
  vehiclesToRender,
  filteredVehicles,
  feedVehicles,
  viewMode,
  cardsPerRow,
  gridCardSizePx,
  thumbFitMode,
  thermalPricing,
  infoDense,
  session,
  orgWebsitesById,
  loading,
  loadingMore,
  hasMore,
  error,
  isRenderTruncated,
  filteredRenderLimit,
  setFilteredRenderLimit,
  FILTERED_RENDER_STEP,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  gridRef,
  infiniteSentinelRef,
}) => {
  const navigate = useNavigate();

  // --- Hover card state ---
  const [hoverVehicle, setHoverVehicle] = useState<any | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Long-press state (mobile) ---
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);

  const handleCardMouseEnter = useCallback((vehicle: any, e: React.MouseEvent) => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    // Capture rect synchronously — currentTarget is null after the event handler returns
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      setHoverPosition({ x: rect.right + 10, y: rect.top });
      setHoverVehicle(vehicle);
    }, 200);
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // Allow 100ms to move mouse to hover card
    dismissTimerRef.current = setTimeout(() => {
      setHoverVehicle(null);
    }, 100);
  }, []);

  const handleHoverCardClose = useCallback(() => {
    setHoverVehicle(null);
  }, []);

  const handleHoverCardAction = useCallback((action: string) => {
    if (action === 'details' && hoverVehicle) {
      navigate(`/vehicle/${hoverVehicle.id}`);
    }
    setHoverVehicle(null);
  }, [hoverVehicle, navigate]);

  // Mobile long-press handlers
  const handleTouchStart = useCallback((vehicle: any, e: React.TouchEvent) => {
    longPressTriggeredRef.current = false;
    const touch = e.touches[0];
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setHoverPosition({ x: touch.clientX, y: touch.clientY - 100 });
      setHoverVehicle(vehicle);
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const getSourceStampUrl = useCallback((vehicle: any) => {
    return (
      (vehicle?.origin_organization_id ? orgWebsitesById[String(vehicle.origin_organization_id)]?.website : undefined) ||
      vehicle?.discovery_url
    );
  }, [orgWebsitesById]);

  return (
    <>
      {/* Gallery View */}
      {viewMode === 'gallery' && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          {vehiclesToRender.map((vehicle) => (
            <div
              key={vehicle.id}
              onMouseEnter={(e) => handleCardMouseEnter(vehicle, e)}
              onMouseLeave={handleCardMouseLeave}
              onTouchStart={(e) => handleTouchStart(vehicle, e)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
            >
              <VehicleCardDense
                vehicle={vehicle}
                viewMode="gallery"
                infoDense={infoDense}
                viewerUserId={session?.user?.id}
                showFollowButton={!!session?.user?.id}
                thermalPricing={false}
                sourceStampUrl={getSourceStampUrl(vehicle)}
                disableHoverCard
              />
            </div>
          ))}
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div ref={gridRef} style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, Math.min(16, cardsPerRow))}, minmax(0, 1fr))`,
          gap: '8px',
        }}>
          {vehiclesToRender.map((vehicle) => (
            <div
              key={vehicle.id}
              onMouseEnter={(e) => handleCardMouseEnter(vehicle, e)}
              onMouseLeave={handleCardMouseLeave}
              onTouchStart={(e) => handleTouchStart(vehicle, e)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              style={{ position: 'relative' }}
            >
              <VehicleCardDense
                vehicle={vehicle}
                viewMode="grid"
                cardSizePx={gridCardSizePx}
                infoDense={false}
                showFollowButton={!!session?.user?.id}
                showDetailOverlay={true}
                viewerUserId={session?.user?.id}
                thermalPricing={thermalPricing}
                thumbnailFit={thumbFitMode === 'original' ? 'contain' : 'cover'}
                sourceStampUrl={getSourceStampUrl(vehicle)}
                disableHoverCard
              />
            </div>
          ))}
        </div>
      )}

      {/* Show more button */}
      {isRenderTruncated && (viewMode === 'grid' || viewMode === 'gallery') && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
          <button
            type="button"
            className="button-win95"
            onClick={() => setFilteredRenderLimit((prev) => prev + FILTERED_RENDER_STEP)}
          >
            Show more ({Math.max(0, filteredVehicles.length - vehiclesToRender.length)} more)
          </button>
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {!error && filteredVehicles.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
          <div ref={infiniteSentinelRef} style={{ width: '1px', height: '1px' }} />
          {loadingMore && <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Loading...</div>}
          {!hasMore && !loadingMore && (
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>End of results</div>
          )}
        </div>
      )}

      {/* Hover card overlay */}
      {hoverVehicle && (
        <div
          onMouseEnter={() => {
            // Keep hover card visible when mouse enters it
            if (dismissTimerRef.current) {
              clearTimeout(dismissTimerRef.current);
              dismissTimerRef.current = null;
            }
          }}
          onMouseLeave={handleHoverCardClose}
        >
          <VehicleHoverCard
            vehicle={hoverVehicle}
            position={hoverPosition}
            onClose={handleHoverCardClose}
            onAction={handleHoverCardAction}
            viewerUserId={session?.user?.id}
          />
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          padding: 'var(--space-8)',
          margin: 'var(--space-4)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text)' }}>
            {error}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--grey-600)',
              color: 'white',
              border: '2px solid var(--border)',
              padding: '6px 16px',
              fontSize: '9pt',
              cursor: 'pointer',
              fontFamily: '"MS Sans Serif", sans-serif',
            }}
          >
            Refresh
          </button>
        </div>
      )}

      {/* Empty state */}
      {filteredVehicles.length === 0 && !loading && !error && (
        <div style={{
          background: 'var(--white)',
          border: '2px solid var(--border)',
          padding: 'var(--space-8)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
            No vehicles found
          </div>
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {feedVehicles.length === 0
              ? 'Be the first to add a build and start the hype train!'
              : 'Try adjusting your filters to see more results.'
            }
          </div>
          {feedVehicles.length === 0 && (
            <button
              onClick={() => navigate('/add-vehicle')}
              style={{
                background: 'var(--grey-600)',
                color: 'var(--white)',
                border: '2px solid var(--border)',
                padding: '8px 16px',
                fontSize: '9pt',
                cursor: 'pointer',
                fontFamily: '"MS Sans Serif", sans-serif',
              }}
            >
              Add Your First Vehicle
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default React.memo(FeedGrid);
