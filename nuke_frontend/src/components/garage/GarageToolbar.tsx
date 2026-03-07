/**
 * GarageToolbar.tsx
 * Contextual toolbar rendered inside the AppHeader via toolbar slot.
 * Design system compliant: 0 border-radius, 0 shadows, CSS vars only.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import type { ViewMode, SortMode, FilterMode } from '../../hooks/useVehiclesDashboard';

const FONT = 'Arial, sans-serif';
const MONO = "'Courier New', Courier, monospace";
const EASE = '180ms cubic-bezier(0.16, 1, 0.3, 1)';

// ---------------------------------------------------------------------------
// SegmentedControl
// ---------------------------------------------------------------------------

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', border: '2px solid var(--border, #bdbdbd)', overflow: 'hidden' }}>
      {options.map((opt, i) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            padding: '3px 6px',
            fontSize: 8,
            fontFamily: FONT,
            fontWeight: value === opt ? 700 : 400,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            cursor: 'pointer',
            border: 'none',
            borderLeft: i > 0 ? '1px solid var(--border, #bdbdbd)' : 'none',
            borderRadius: 0,
            backgroundColor: value === opt ? 'var(--text, #2a2a2a)' : 'transparent',
            color: value === opt ? 'var(--bg, #f5f5f5)' : 'var(--text, #2a2a2a)',
            transition: `background-color ${EASE}, color ${EASE}`,
            lineHeight: 1.2,
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

function Div() {
  return (
    <div
      style={{
        width: 1,
        height: 14,
        backgroundColor: 'var(--border, #bdbdbd)',
        flexShrink: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// GarageToolbar
// ---------------------------------------------------------------------------

interface GarageToolbarProps {
  vehicleCount: number;
  totalValue: number;
  viewMode: ViewMode;
  sortMode: SortMode;
  filterMode: FilterMode;
  onViewChange: (v: ViewMode) => void;
  onSortChange: (v: SortMode) => void;
  onFilterChange: (v: FilterMode) => void;
}

export function GarageToolbar({
  vehicleCount,
  totalValue,
  viewMode,
  sortMode,
  filterMode,
  onViewChange,
  onSortChange,
  onFilterChange,
}: GarageToolbarProps) {
  const formattedValue = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    notation: totalValue >= 1_000_000 ? 'compact' : 'standard',
  }).format(totalValue);

  const label: React.CSSProperties = {
    fontSize: 8,
    fontFamily: FONT,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary, #666666)',
    whiteSpace: 'nowrap',
  };

  const mono: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums lining-nums',
    color: 'var(--text, #2a2a2a)',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '4px 12px',
        background: 'var(--surface, #ebebeb)',
        fontFamily: FONT,
      }}
    >
      {/* Vehicle count */}
      <span style={label}>VEHICLES</span>
      <span style={mono}>{vehicleCount}</span>

      <Div />

      {/* Est. value */}
      <span style={label}>EST. VALUE</span>
      <span style={mono}>{totalValue > 0 ? formattedValue : '—'}</span>

      <Div />

      {/* View mode */}
      <SegmentedControl<ViewMode>
        options={['GRID', 'LIST', 'COMPACT']}
        value={viewMode}
        onChange={onViewChange}
      />

      <Div />

      {/* Sort */}
      <SegmentedControl<SortMode>
        options={['RECENT', 'VALUE', 'HEALTH', 'NAME']}
        value={sortMode}
        onChange={onSortChange}
      />

      <Div />

      {/* Filter */}
      <SegmentedControl<FilterMode>
        options={['ALL', 'OWNED', 'CONTRIBUTED']}
        value={filterMode}
        onChange={onFilterChange}
      />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Add vehicle */}
      <AddVehicleBtn />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Vehicle button (btn-utility pattern)
// ---------------------------------------------------------------------------

function AddVehicleBtn() {
  const [hovered, setHovered] = React.useState(false);
  return (
    <Link
      to="/vehicle/add"
      style={{
        textDecoration: 'none',
        fontSize: 9,
        fontFamily: FONT,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '3px 8px',
        border: '2px solid var(--text, #2a2a2a)',
        borderRadius: 0,
        backgroundColor: hovered ? 'var(--text, #2a2a2a)' : 'transparent',
        color: hovered ? 'var(--bg, #f5f5f5)' : 'var(--text, #2a2a2a)',
        transition: `background-color ${EASE}, color ${EASE}`,
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      + ADD VEHICLE
    </Link>
  );
}
