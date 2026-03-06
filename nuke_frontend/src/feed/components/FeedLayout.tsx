/**
 * FeedLayout — Virtualized grid/list/table container.
 *
 * Uses @tanstack/react-virtual useWindowVirtualizer.
 * Technical view has a proper sticky header row.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { FeedVehicle, FeedViewConfig } from '../types/feed';

export interface FeedLayoutProps {
  vehicles: FeedVehicle[];
  viewMode: FeedViewConfig['viewMode'];
  cardsPerRow: number;
  showScores?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  renderCard: (vehicle: FeedVehicle, index: number) => ReactNode;
}

const ROW_HEIGHTS: Record<string, number> = {
  grid: 320,
  gallery: 84,
  technical: 32,
};

const TABLE_GRID = '42px 44px 90px 1fr 70px 80px 70px 50px minmax(60px, auto) minmax(60px, auto) 70px';
const TABLE_GRID_SCORES = '42px 44px 90px 1fr 70px 80px 70px 50px minmax(60px, auto) minmax(60px, auto) 70px 50px';

export function FeedLayout({
  vehicles,
  viewMode,
  cardsPerRow,
  showScores = false,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  renderCard,
}: FeedLayoutProps) {
  const tableGrid = showScores ? TABLE_GRID_SCORES : TABLE_GRID;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const cols = viewMode === 'grid' ? cardsPerRow : 1;
  const rowCount = Math.ceil(vehicles.length / cols) + (hasNextPage ? 1 : 0);
  const estimateSize = useCallback(() => ROW_HEIGHTS[viewMode] ?? 320, [viewMode]);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize,
    overscan: 5,
  });

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || !fetchNextPage) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) fetchNextPage(); },
      { rootMargin: '400px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = virtualizer.getVirtualItems();

  // Technical table view
  if (viewMode === 'technical') {
    return (
      <div style={{ position: 'relative' }}>
        {/* Sticky header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: tableGrid,
            gap: '0 4px',
            padding: '4px 8px',
            borderBottom: '2px solid var(--border)',
            position: 'sticky',
            top: 'calc(var(--header-height, 48px) + 32px)',
            background: 'var(--surface)',
            zIndex: 10,
            fontFamily: 'Arial, sans-serif',
            fontSize: 'var(--feed-font-size-xs, 7px)',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: 'var(--text-disabled)',
            alignItems: 'center',
            height: '24px',
          }}
        >
          <span />
          <span>YEAR</span>
          <span>MAKE</span>
          <span>MODEL</span>
          <span style={{ textAlign: 'right' }}>MILES</span>
          <span style={{ textAlign: 'right' }}>PRICE</span>
          <span>BODY</span>
          <span>TRANS</span>
          <span>DEAL</span>
          <span>HEAT</span>
          <span style={{ textAlign: 'right' }}>TIME</span>
          {showScores && <span style={{ textAlign: 'right' }}>RANK</span>}
        </div>

        {/* Virtualized rows */}
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {items.map((vRow) => {
            const startIdx = vRow.index * cols;
            const isLoaderRow = startIdx >= vehicles.length;

            if (isLoaderRow) {
              return (
                <div
                  key={vRow.key}
                  ref={sentinelRef}
                  data-index={vRow.index}
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%',
                    transform: `translateY(${vRow.start}px)`,
                    height: '32px', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: '8px',
                    fontFamily: 'Arial, sans-serif', color: 'var(--text-disabled)',
                  }}
                >
                  {isFetchingNextPage ? 'Loading...' : ''}
                </div>
              );
            }

            const vehicle = vehicles[startIdx];
            if (!vehicle) return null;

            return (
              <div
                key={vRow.key}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  transform: `translateY(${vRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: tableGrid,
                  gap: '0 4px',
                  alignItems: 'center',
                  height: '32px',
                  padding: '0 8px',
                  borderBottom: '1px solid var(--border)',
                  background: vRow.index % 2 === 0 ? 'var(--surface)' : 'var(--surface-hover)',
                  fontSize: 'var(--feed-font-size, 10px)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                {renderCard(vehicle, startIdx)}
              </div>
            );
          })}
        </div>

        {hasNextPage && items.length > 0 && (
          <div ref={sentinelRef} style={{ height: '1px', position: 'absolute', bottom: 0 }} />
        )}
      </div>
    );
  }

  // Grid / Gallery
  return (
    <div style={{ position: 'relative', width: '100%', height: `${virtualizer.getTotalSize()}px` }}>
      {items.map((virtualRow) => {
        const startIdx = virtualRow.index * cols;
        const isLoaderRow = startIdx >= vehicles.length;

        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {isLoaderRow ? (
              <div
                ref={sentinelRef}
                style={{
                  height: `${ROW_HEIGHTS[viewMode] ?? 320}px`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '9px', fontFamily: 'Arial, sans-serif',
                  color: 'var(--text-disabled)', textTransform: 'uppercase',
                }}
              >
                {isFetchingNextPage ? 'Loading...' : ''}
              </div>
            ) : viewMode === 'grid' ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: '4px',
              }}>
                {Array.from({ length: cols }, (_, colIdx) => {
                  const idx = startIdx + colIdx;
                  const v = vehicles[idx];
                  if (!v) return <div key={colIdx} />;
                  return <div key={v.id}>{renderCard(v, idx)}</div>;
                })}
              </div>
            ) : (
              <div style={{ marginBottom: '1px' }}>
                {vehicles[startIdx] && renderCard(vehicles[startIdx], startIdx)}
              </div>
            )}
          </div>
        );
      })}

      {hasNextPage && items.length > 0 && (
        <div ref={sentinelRef} style={{ height: '1px', position: 'absolute', bottom: 0 }} />
      )}
    </div>
  );
}
