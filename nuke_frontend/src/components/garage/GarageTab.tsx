/**
 * GarageTab.tsx
 * Redesigned garage tab following the NUKE design system.
 *
 * Features:
 *  - Toolbar: vehicle count, total value, view/sort/filter toggles, ADD VEHICLE
 *  - Sections grouped by relationship type with counts
 *  - Grid / List / Compact view modes
 *  - Skeleton loading (static rectangles, no animation)
 *  - Utilitarian empty state (no illustration)
 */

import React, { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ViewMode, FilterMode, GarageSection, GarageVehicle, VehiclesDashboardState } from '../../hooks/useVehiclesDashboard';
import { GarageVehicleCard } from '../vehicles/GarageVehicleCard';
import TriageDock from './TriageDock';
import type { TriageAction } from './TriageDock';
import { supabase } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Design tokens (inline, referencing CSS vars)
// ---------------------------------------------------------------------------

const FONT_BODY = 'Arial, sans-serif';
const FONT_MONO = "'Courier New', Courier, monospace";

const s = {
  wrap: {
    fontFamily: FONT_BODY,
    fontSize: '9px',
    color: 'var(--text, #2a2a2a)',
    backgroundColor: 'var(--bg, #f5f5f5)',
    minHeight: '100%',
  } as React.CSSProperties,

  content: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  } as React.CSSProperties,

  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: 'var(--text, #2a2a2a)',
  } as React.CSSProperties,

  sectionCount: {
    fontSize: '8px',
    fontFamily: FONT_MONO,
    fontVariantNumeric: 'tabular-nums lining-nums' as const,
    color: 'var(--text-secondary, #666666)',
    border: '2px solid var(--border, #bdbdbd)',
    padding: '0 4px', } as React.CSSProperties,

  sectionDivider: {
    flex: 1,
    height: 1,
    backgroundColor: 'var(--border, #bdbdbd)',
  } as React.CSSProperties,

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 8,
  } as React.CSSProperties,

  list: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  } as React.CSSProperties,

  compact: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  } as React.CSSProperties,
};

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeaderRow({ title, count }: { title: string; count: number }) {
  return (
    <div style={s.sectionHeader}>
      <span style={s.sectionTitle}>{title}</span>
      <span style={s.sectionCount}>{count}</span>
      <div style={s.sectionDivider} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vehicle grid / list for one section
// ---------------------------------------------------------------------------

function SectionVehicles({
  section,
  viewMode,
  onRefresh,
  draggingVehicle,
  onDragStart,
  onDragEnd,
}: {
  section: GarageSection;
  viewMode: ViewMode;
  onRefresh: () => void;
  draggingVehicle: GarageVehicle | null;
  onDragStart: (v: GarageVehicle) => void;
  onDragEnd: () => void;
}) {
  const containerStyle =
    viewMode === 'GRID' ? s.grid : viewMode === 'LIST' ? s.list : s.compact;

  return (
    <div style={containerStyle}>
      {section.vehicles.map((v) => (
        <GarageVehicleCard
          key={v.id}
          vehicle={v}
          viewMode={viewMode}
          onRefresh={onRefresh}
          onDragStart={() => onDragStart(v)}
          onDragEnd={onDragEnd}
          isDragging={draggingVehicle?.id === v.id}
          isTriageActive={draggingVehicle !== null && draggingVehicle.id !== v.id}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  const count = viewMode === 'COMPACT' ? 8 : 6;
  const heights: Record<ViewMode, number> = { GRID: 300, LIST: 88, COMPACT: 32 };
  const containerStyle = viewMode === 'GRID' ? s.grid : viewMode === 'LIST' ? s.list : s.compact;

  return (
    <div style={s.content}>
      <div style={containerStyle}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            style={{
              height: heights[viewMode],
              backgroundColor: 'var(--border, #bdbdbd)', border: '2px solid var(--border, #bdbdbd)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  filterMode,
  onClearFilter,
}: {
  filterMode: FilterMode;
  onClearFilter: () => void;
}) {
  const isFiltered = filterMode !== 'ALL';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        gap: 12,
        border: '2px solid var(--border, #bdbdbd)',
        margin: '12px',
      }}
    >
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--text, #2a2a2a)',
        }}
      >
        {isFiltered ? `NO ${filterMode} VEHICLES` : 'NO VEHICLES'}
      </span>
      <span
        style={{
          fontSize: '9px',
          color: 'var(--text-secondary, #666666)',
          textAlign: 'center',
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        {isFiltered
          ? `No vehicles match the "${filterMode}" filter.`
          : 'Add your first vehicle to start building your garage.'}
      </span>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {isFiltered && (
          <button
            onClick={onClearFilter}
            style={{
              fontSize: '9px',
              fontFamily: FONT_BODY,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.5px',
              fontWeight: 700,
              padding: '5px 12px',
              border: '2px solid var(--border, #bdbdbd)', backgroundColor: 'transparent',
              color: 'var(--text, #2a2a2a)',
              cursor: 'pointer',
              transition: 'border-color 0.12s ease',
            }}
          >
            CLEAR FILTER
          </button>
        )}
        <Link to="/vehicle/add" style={{ textDecoration: 'none' }}>
          <div
            style={{
              fontSize: '9px',
              fontFamily: FONT_BODY,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.5px',
              fontWeight: 700,
              padding: '5px 12px',
              border: '2px solid var(--text, #2a2a2a)', backgroundColor: 'var(--text, #2a2a2a)',
              color: 'var(--bg, #f5f5f5)',
              whiteSpace: 'nowrap' as const,
            }}
          >
            ADD VEHICLE
          </div>
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        gap: 10,
        border: '2px solid var(--error, #d13438)',
        margin: '12px',
      }}
    >
      <span
        style={{
          fontSize: '9px',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--error, #d13438)',
        }}
      >
        FAILED TO LOAD GARAGE
      </span>
      <span style={{ fontSize: '9px', color: 'var(--text-secondary, #666666)', fontFamily: FONT_MONO }}>
        {message}
      </span>
      <button
        onClick={onRetry}
        style={{
          marginTop: 4,
          fontSize: '9px',
          fontFamily: FONT_BODY,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          fontWeight: 700,
          padding: '5px 12px',
          border: '2px solid var(--error, #d13438)', backgroundColor: 'transparent',
          color: 'var(--error, #d13438)',
          cursor: 'pointer',
        }}
      >
        RETRY
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function GarageTab({ dashboard }: { dashboard: VehiclesDashboardState }) {
  const {
    sections,
    vehicles,
    isLoading,
    error,
    viewMode,
    filterMode,
    setFilterMode,
    refresh,
  } = dashboard;

  const [draggingVehicle, setDraggingVehicle] = useState<GarageVehicle | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Get user ID for triage actions
  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id);
    });
  }, []);

  const clearFilter = useCallback(() => setFilterMode('ALL'), [setFilterMode]);

  const handleDragStart = useCallback((v: GarageVehicle) => setDraggingVehicle(v), []);
  const handleDragEnd = useCallback(() => setDraggingVehicle(null), []);

  const handleTriageComplete = useCallback((action: TriageAction) => {
    setDraggingVehicle(null);
    // Small delay to let toast show before refreshing
    setTimeout(() => refresh(), 600);
  }, [refresh]);

  const showSections = sections.length > 1;

  const dragProps = {
    draggingVehicle,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
  };

  return (
    <div style={s.wrap}>
      {isLoading ? (
        <LoadingSkeleton viewMode={viewMode} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : vehicles.length === 0 ? (
        <EmptyState filterMode={filterMode} onClearFilter={clearFilter} />
      ) : (
        <div style={{ ...s.content, paddingBottom: draggingVehicle ? 132 : undefined }}>
          {showSections
            ? sections.map((section) => (
                <div key={section.relationship_type}>
                  <SectionHeaderRow
                    title={section.relationship_type}
                    count={section.vehicles.length}
                  />
                  <SectionVehicles section={section} viewMode={viewMode} onRefresh={refresh} {...dragProps} />
                </div>
              ))
            : sections.map((section) => (
                <SectionVehicles
                  key={section.relationship_type}
                  section={section}
                  viewMode={viewMode}
                  onRefresh={refresh}
                  {...dragProps}
                />
              ))}
        </div>
      )}

      {draggingVehicle && userId && (
        <TriageDock
          vehicle={draggingVehicle}
          userId={userId}
          onComplete={handleTriageComplete}
          onDragEnd={handleDragEnd}
        />
      )}
    </div>
  );
}
