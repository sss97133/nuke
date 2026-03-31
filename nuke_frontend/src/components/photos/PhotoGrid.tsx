/**
 * PhotoGrid — Virtualized photo grid using @tanstack/react-virtual.
 *
 * Renders tens of thousands of photos smoothly by only mounting visible rows.
 * Uses row-based virtualization inside a scrollable container panel (not window).
 * Includes date section headers and an infinite scroll sentinel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PersonalPhoto } from '../../services/personalPhotoLibraryService';
import { PhotoTile } from './PhotoTile';
import { preloadImageBatch } from '../../lib/imageOptimizer';
import type { ImageSize } from '../../lib/imageOptimizer';

interface PhotoGridProps {
  photos: PersonalPhoto[];
  selectedPhotos: Set<string>;
  columns: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  onPhotoClick: (photoId: string, event: React.MouseEvent) => void;
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchMove?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchEnd?: (e: React.TouchEvent<HTMLDivElement>) => void;
  /** Called with the current date label when scrolling through date groups */
  onDateChange?: (dateLabel: string | null) => void;
  /** Ref to the virtualizer for external scroll-to-index (used by TimelineScrubber) */
  virtualizerRef?: React.MutableRefObject<ReturnType<typeof useVirtualizer> | null>;
}

const DATE_HEADER_HEIGHT = 28;

/** Group photos by date (taken_at or created_at) → "March 2024", etc.
 *  Merges non-consecutive groups with the same month label to prevent duplicate headers. */
function groupPhotosByDate(photos: PersonalPhoto[]): Array<
  | { type: 'header'; label: string; key: string }
  | { type: 'photos'; startIndex: number; count: number; key: string }
> {
  if (photos.length === 0) return [];

  // First pass: collect raw groups by scanning consecutive runs
  const rawGroups: Array<{ label: string; startIndex: number; count: number }> = [];
  const monthFormatter = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long' });
  let currentMonth = '';
  let groupStart = 0;

  for (let i = 0; i <= photos.length; i++) {
    const photo = photos[i];
    const dateStr = photo ? (photo.taken_at || photo.created_at) : null;
    const month = dateStr ? monthFormatter.format(new Date(dateStr)) : 'Unknown';

    if (i === photos.length || month !== currentMonth) {
      if (i > groupStart && currentMonth) {
        rawGroups.push({ label: currentMonth, startIndex: groupStart, count: i - groupStart });
      }
      currentMonth = month;
      groupStart = i;
    }
  }

  // Second pass: merge groups with the same month label (handles unsorted data)
  const mergedMap = new Map<string, Array<{ startIndex: number; count: number }>>();
  const labelOrder: string[] = [];
  for (const g of rawGroups) {
    if (!mergedMap.has(g.label)) {
      mergedMap.set(g.label, []);
      labelOrder.push(g.label);
    }
    mergedMap.get(g.label)!.push({ startIndex: g.startIndex, count: g.count });
  }

  // Build final rows with deduplicated headers
  const rows: Array<
    | { type: 'header'; label: string; key: string }
    | { type: 'photos'; startIndex: number; count: number; key: string }
  > = [];

  for (const label of labelOrder) {
    rows.push({ type: 'header', label, key: `header-${label}` });
    for (const chunk of mergedMap.get(label)!) {
      rows.push({ type: 'photos', startIndex: chunk.startIndex, count: chunk.count, key: `photos-${chunk.startIndex}` });
    }
  }

  return rows;
}

/** Resolve date-grouped rows into virtual rows (headers + photo grid rows) */
function buildVirtualRows(
  dateGroups: ReturnType<typeof groupPhotosByDate>,
  columns: number,
): Array<
  | { type: 'header'; label: string }
  | { type: 'photos'; photoIndices: number[] }
  | { type: 'sentinel' }
> {
  const virtualRows: Array<
    | { type: 'header'; label: string }
    | { type: 'photos'; photoIndices: number[] }
    | { type: 'sentinel' }
  > = [];

  // At high density, suppress headers and pack all photos continuously
  const showHeaders = columns <= 8;

  if (!showHeaders) {
    // Continuous mode: collect ALL photo indices, ignore headers
    const allIndices: number[] = [];
    for (const group of dateGroups) {
      if (group.type === 'photos') {
        for (let i = 0; i < group.count; i++) {
          allIndices.push(group.startIndex + i);
        }
      }
    }
    for (let offset = 0; offset < allIndices.length; offset += columns) {
      const indices = allIndices.slice(offset, offset + columns);
      virtualRows.push({ type: 'photos', photoIndices: indices });
    }
  } else {
    for (const group of dateGroups) {
      if (group.type === 'header') {
        virtualRows.push({ type: 'header', label: group.label });
      } else {
        // Split photo group into rows of `columns` width
        for (let offset = 0; offset < group.count; offset += columns) {
          const indices: number[] = [];
          for (let c = 0; c < columns && offset + c < group.count; c++) {
            indices.push(group.startIndex + offset + c);
          }
          virtualRows.push({ type: 'photos', photoIndices: indices });
        }
      }
    }
  }

  return virtualRows;
}

export function PhotoGrid({
  photos,
  selectedPhotos,
  columns,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onPhotoClick,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onDateChange,
  virtualizerRef,
}: PhotoGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build date-grouped virtual rows
  const dateGroups = useMemo(() => groupPhotosByDate(photos), [photos]);
  const virtualRows = useMemo(
    () => buildVirtualRows(dateGroups, columns),
    [dateGroups, columns],
  );

  // No sentinel in virtual rows — it's rendered separately outside the virtualizer
  const rowCount = virtualRows.length;

  // Use actual container width for row height estimation (square tiles)
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const estimateSize = useCallback(
    (index: number) => {
      const row = virtualRows[index];
      if (!row || row.type === 'header') return DATE_HEADER_HEIGHT;
      // Square tiles: row height = container width / columns (+ 1px gap)
      const w = containerWidth || 800;
      return Math.round(w / columns) + 1;
    },
    [virtualRows, columns, containerWidth],
  );

  // Overscan in rows — cap total overscan tiles to ~60 max
  const overscan = useMemo(
    () => Math.max(1, Math.min(5, Math.floor(60 / columns))),
    [columns],
  );

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan,
  });

  // Expose virtualizer to parent for TimelineScrubber
  useEffect(() => {
    if (virtualizerRef) {
      virtualizerRef.current = virtualizer;
    }
  }, [virtualizer, virtualizerRef]);

  // Infinite scroll sentinel — IntersectionObserver fires immediately when content
  // doesn't fill viewport (classic virtual-scroll fix for high column counts).
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      { root: scrollRef.current, rootMargin: '800px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, photos.length]);

  // Belt-and-suspenders: also check on scroll for browsers with flaky IO support
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (!hasNextPage || isFetchingNextPage) return;
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining < 800) fetchNextPage();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Auto-fetch when content doesn't fill the viewport (high column counts).
  // After each data change, if the scroll container has no overflow, fetch more.
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const el = scrollRef.current;
    if (!el) return;

    // Use rAF to wait for React to render the new rows before measuring
    const raf = requestAnimationFrame(() => {
      if (el.scrollHeight <= el.clientHeight + 100) {
        fetchNextPage();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, photos.length]);

  // Track current date header for sticky overlay
  useEffect(() => {
    if (!onDateChange) return;
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) {
      onDateChange(null);
      return;
    }

    // Find the header closest to the top of the scroll area
    let currentLabel: string | null = null;
    for (const item of items) {
      const row = virtualRows[item.index];
      if (row && row.type === 'header') {
        if (item.start <= (scrollRef.current?.scrollTop ?? 0) + 60) {
          currentLabel = row.label;
        }
      }
    }
    onDateChange(currentLabel);
  });

  // Preload next 2 rows of images beyond the visible set
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    if (items.length === 0) return;
    const lastVisibleIdx = items[items.length - 1].index;
    const preloadSize: ImageSize = columns >= 13 ? 'micro' : columns >= 7 ? 'thumbnail' : columns >= 4 ? 'small' : 'medium';
    const urlsToPreload: (string | null)[] = [];
    // Gather photo URLs from the next 2 rows beyond visible
    for (let ri = lastVisibleIdx + 1; ri <= lastVisibleIdx + 2 && ri < virtualRows.length; ri++) {
      const row = virtualRows[ri];
      if (row && row.type === 'photos') {
        for (const idx of row.photoIndices) {
          const photo = photos[idx];
          if (photo) urlsToPreload.push(photo.image_url);
        }
      }
    }
    if (urlsToPreload.length > 0) {
      preloadImageBatch(urlsToPreload, preloadSize, columns * 2);
    }
  }, [items, virtualRows, photos, columns]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        background: 'var(--text)',
        position: 'relative',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {items.map((virtualRow) => {
          const rowIndex = virtualRow.index;
          const row = virtualRows[rowIndex];
          if (!row) return null;

          // Date header row
          if (row.type === 'header') {
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}

                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${DATE_HEADER_HEIGHT}px`,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '9px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'rgba(255,255,255,0.5)',
                  background: 'var(--text)',
                }}
              >
                {row.label}
              </div>
            );
          }

          // Photo row
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: '1px',
                }}
              >
                {row.photoIndices.map((photoIdx) => {
                  const photo = photos[photoIdx];
                  if (!photo) return <div key={photoIdx} />;
                  return (
                    <PhotoTile
                      key={photo.id}
                      photo={photo}
                      isSelected={selectedPhotos.has(photo.id)}
                      columns={columns}
                      onClick={onPhotoClick}
                      selectedPhotoIds={selectedPhotos}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sentinel for IntersectionObserver — always rendered so IO can observe it */}
      <div ref={sentinelRef} style={{ height: 1, width: '100%' }} />

      {/* Loading spacer */}
      {isFetchingNextPage && (
        <div style={{ height: '40px' }} />
      )}
    </div>
  );
}
