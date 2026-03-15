/**
 * FeedLayout — Virtualized grid/list/table container.
 *
 * Uses @tanstack/react-virtual useWindowVirtualizer.
 * Technical view has a proper sticky header row.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { FeedVehicle, FeedViewConfig } from '../types/feed';
import type { SortBy, SortDirection } from '../../types/feedTypes';

export interface FeedLayoutProps {
  vehicles: FeedVehicle[];
  viewMode: FeedViewConfig['viewMode'];
  cardsPerRow: number;
  showScores?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  renderCard: (vehicle: FeedVehicle, index: number) => ReactNode;
  /** Optional stat card injected every `statCardInterval` vehicle rows in grid mode */
  renderStatCard?: (index: number) => ReactNode;
  /** How many vehicle rows between stat cards (default 5) */
  statCardInterval?: number;
  /** Current sort key (for table column header highlighting) */
  sort?: SortBy;
  /** Current sort direction */
  sortDirection?: SortDirection;
  /** Called when user clicks a table column header */
  onSortChange?: (sort: SortBy) => void;
  /** Called when user toggles sort direction */
  onDirectionChange?: (dir: SortDirection) => void;
}

const ROW_HEIGHTS: Record<string, number> = {
  grid: 320,
  gallery: 84,
  technical: 36,
};

const TABLE_GRID = '60px 50px 100px 1fr 84px 100px 72px 56px 64px 64px 80px';
const TABLE_GRID_SCORES = '60px 50px 100px 1fr 84px 100px 72px 56px 64px 64px 80px 56px';

/** Column-to-sort mapping for table header clicks */
const COLUMN_SORT_MAP: Record<string, SortBy> = {
  YEAR: 'year',
  MAKE: 'make',
  MODEL: 'model',
  MILES: 'mileage',
  PRICE: 'price_high',
  DEAL: 'deal_score',
  HEAT: 'heat_score',
  TIME: 'newest',
};

/** Columns that toggle between two sort keys */
const COLUMN_TOGGLE_MAP: Record<string, [SortBy, SortBy]> = {
  PRICE: ['price_high', 'price_low'],
  TIME: ['newest', 'oldest'],
};

export function FeedLayout({
  vehicles,
  viewMode,
  cardsPerRow,
  showScores = false,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  renderCard,
  renderStatCard,
  statCardInterval = 5,
  sort,
  sortDirection,
  onSortChange,
  onDirectionChange,
}: FeedLayoutProps) {
  const tableGrid = showScores ? TABLE_GRID_SCORES : TABLE_GRID;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const cols = viewMode === 'grid' ? cardsPerRow : 1;
  const vehicleRowCount = Math.ceil(vehicles.length / cols);

  // In grid mode with stat cards, inject a stat row every N vehicle rows
  const useStatCards = viewMode === 'grid' && !!renderStatCard && statCardInterval > 0;
  const statCardCount = useStatCards ? Math.floor(vehicleRowCount / statCardInterval) : 0;
  const rowCount = vehicleRowCount + statCardCount + (hasNextPage ? 1 : 0);

  /** Map virtual row index → { type, vehicleRowIndex, statCardIndex } */
  const resolveRow = useCallback((virtualIdx: number) => {
    if (!useStatCards) return { type: 'vehicle' as const, vehicleRowIdx: virtualIdx };
    // Every (statCardInterval + 1) rows, one is a stat card (at position statCardInterval)
    const groupSize = statCardInterval + 1;
    const group = Math.floor(virtualIdx / groupSize);
    const offset = virtualIdx % groupSize;
    if (offset === statCardInterval) {
      return { type: 'stat' as const, statCardIdx: group };
    }
    return { type: 'vehicle' as const, vehicleRowIdx: group * statCardInterval + offset };
  }, [useStatCards, statCardInterval]);

  const STAT_CARD_HEIGHT = 48;
  const estimateSize = useCallback((idx: number) => {
    if (useStatCards) {
      const row = resolveRow(idx);
      if (row.type === 'stat') return STAT_CARD_HEIGHT;
    }
    return ROW_HEIGHTS[viewMode] ?? 320;
  }, [viewMode, useStatCards, resolveRow]);

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
    const COLS = ['YEAR', 'MAKE', 'MODEL', 'MILES', 'PRICE', 'BODY', 'TRANS', 'DEAL', 'HEAT', 'TIME'] as const;

    return (
      <div style={{ position: 'relative' }}>
        {/* Sticky header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: tableGrid,
            gap: '0 8px',
            padding: '0 12px',
            borderBottom: '2px solid var(--text)',
            position: 'sticky',
            top: 'var(--header-height, 48px)',
            background: 'var(--surface)',
            zIndex: 10,
            fontFamily: 'Arial, sans-serif',
            fontSize: '9px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-secondary)',
            alignItems: 'center',
            height: '32px',
          }}
        >
          {/* Thumbnail column header — empty */}
          <span />
          {COLS.map((col) => {
            const sortKey = COLUMN_SORT_MAP[col];
            const isSortable = !!sortKey && !!onSortChange;
            const togglePair = COLUMN_TOGGLE_MAP[col];
            const isActive = sort && (sort === sortKey || (togglePair && togglePair.includes(sort)));
            const align = ['MILES', 'PRICE', 'TIME'].includes(col) ? 'right' : 'left';

            const handleClick = () => {
              if (!onSortChange) return;
              if (isActive) {
                if (togglePair && onDirectionChange) {
                  const currentIdx = togglePair.indexOf(sort!);
                  if (currentIdx >= 0) {
                    onSortChange(togglePair[(currentIdx + 1) % 2]);
                  } else {
                    onDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc');
                  }
                } else if (onDirectionChange) {
                  onDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc');
                }
              } else {
                onSortChange(sortKey);
              }
            };

            let arrow = '';
            if (isActive) {
              if (togglePair) {
                arrow = sort === togglePair[0] ? ' \u2193' : ' \u2191';
              } else {
                arrow = sortDirection === 'asc' ? ' \u2191' : ' \u2193';
              }
            }

            if (!isSortable) {
              return <span key={col} style={{ textAlign: align }}>{col}</span>;
            }

            return (
              <button
                key={col}
                type="button"
                onClick={handleClick}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  margin: 0,
                  font: 'inherit',
                  fontWeight: 'inherit',
                  fontSize: 'inherit',
                  letterSpacing: 'inherit',
                  textTransform: 'inherit' as any,
                  color: isActive ? 'var(--text)' : 'inherit',
                  cursor: 'pointer',
                  textAlign: align,
                }}
              >
                {col}{arrow}
              </button>
            );
          })}
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
                    height: '36px', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: '10px',
                    fontFamily: 'Arial, sans-serif', color: 'var(--text-disabled)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}
                >
                  {isFetchingNextPage ? 'LOADING...' : ''}
                </div>
              );
            }

            const vehicle = vehicles[startIdx];
            if (!vehicle) return null;

            const stripe = vRow.index % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent';

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
                  gap: '0 8px',
                  alignItems: 'center',
                  height: '36px',
                  padding: '0 12px',
                  borderBottom: '1px solid var(--border)',
                  background: stripe,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = stripe; }}
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
        const resolved = resolveRow(virtualRow.index);

        // Stat card row
        if (resolved.type === 'stat' && renderStatCard) {
          return (
            <div
              key={`stat-${virtualRow.key}`}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderStatCard(resolved.statCardIdx!)}
            </div>
          );
        }

        const vehicleRowIdx = resolved.vehicleRowIdx!;
        const startIdx = vehicleRowIdx * cols;
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
