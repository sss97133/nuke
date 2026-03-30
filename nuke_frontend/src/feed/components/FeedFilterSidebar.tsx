/**
 * FeedFilterSidebar — Collapsible filter panel for the feed.
 *
 * Sections: Year, Make, Body Style, Price, Status, Sources.
 * ALL CAPS 8px headers, chip toggles, range sliders. Brutalist design.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { FilterState } from '../../types/feedTypes';

export interface FeedFilterSidebarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onResetAll: () => void;
  hasActiveFilters: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

// ---------------------------------------------------------------------------
// Top makes by count (pre-baked from DB — covers 95%+ of inventory)
// ---------------------------------------------------------------------------
const TOP_MAKES = [
  'CHEVROLET', 'FORD', 'PORSCHE', 'MERCEDES-BENZ', 'BMW', 'DODGE',
  'CADILLAC', 'JAGUAR', 'PONTIAC', 'FERRARI', 'TOYOTA', 'VOLKSWAGEN',
  'HONDA', 'PLYMOUTH', 'BUICK', 'OLDSMOBILE', 'NISSAN', 'ROLLS-ROYCE',
  'MG', 'LAND ROVER', 'BENTLEY', 'GMC', 'ALFA ROMEO', 'AUDI',
  'ASTON MARTIN', 'CHRYSLER', 'LINCOLN', 'MAZDA', 'MASERATI', 'LEXUS',
  'JEEP', 'MERCURY', 'SHELBY', 'PACKARD', 'SUBARU', 'LAMBORGHINI',
];

const BODY_STYLES = [
  'COUPE', 'CONVERTIBLE', 'PICKUP', 'SEDAN', 'SUV', 'ROADSTER',
  'WAGON', 'HATCHBACK', 'FASTBACK', 'VAN', 'TARGA',
];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sectionHeaderStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--text-disabled)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer',
  padding: '6px 0',
  userSelect: 'none',
  borderBottom: '1px solid var(--border)',
};

const chipStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  padding: '2px 6px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
  whiteSpace: 'nowrap',
};

const chipActiveStyle: CSSProperties = {
  ...chipStyle,
  borderColor: 'var(--text)',
  color: 'var(--text)',
  background: 'var(--surface-hover)',
};

const inputStyle: CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: '10px',
  padding: '3px 6px',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  outline: 'none',
  width: '100%',
};

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function FilterSection({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div style={sectionHeaderStyle} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>{open ? '−' : '+'}</span>
      </div>
      {open && <div style={{ padding: '6px 0' }}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function FeedFilterSidebar({
  filters,
  onFiltersChange,
  onResetAll,
  hasActiveFilters,
  collapsed = false,
  onToggleCollapsed,
}: FeedFilterSidebarProps) {

  const [makeSearch, setMakeSearch] = useState('');

  const update = useCallback(
    (partial: Partial<FilterState>) => {
      onFiltersChange({ ...filters, ...partial });
    },
    [filters, onFiltersChange],
  );

  // Make toggle
  const toggleMake = useCallback(
    (make: string) => {
      const current = filters.makes;
      const next = current.includes(make)
        ? current.filter((m) => m !== make)
        : [...current, make];
      update({ makes: next });
      setMakeSearch('');
    },
    [filters.makes, update],
  );

  // Body style toggle
  const toggleBodyStyle = useCallback(
    (style: string) => {
      const current = filters.bodyStyles;
      const next = current.includes(style)
        ? current.filter((s) => s !== style)
        : [...current, style];
      update({ bodyStyles: next });
    },
    [filters.bodyStyles, update],
  );

  // Local state for year inputs — committed on blur/Enter to avoid
  // the URL deserializer rejecting partial values (e.g. "19" < 1880).
  const [localYearMin, setLocalYearMin] = useState<string>(filters.yearMin != null ? String(filters.yearMin) : '');
  const [localYearMax, setLocalYearMax] = useState<string>(filters.yearMax != null ? String(filters.yearMax) : '');

  // Sync local state when filters change externally (e.g. reset)
  useEffect(() => {
    setLocalYearMin(filters.yearMin != null ? String(filters.yearMin) : '');
  }, [filters.yearMin]);
  useEffect(() => {
    setLocalYearMax(filters.yearMax != null ? String(filters.yearMax) : '');
  }, [filters.yearMax]);

  const commitYearMin = useCallback(() => {
    const num = localYearMin ? Number(localYearMin) : null;
    update({ yearMin: num });
  }, [localYearMin, update]);

  const commitYearMax = useCallback(() => {
    const num = localYearMax ? Number(localYearMax) : null;
    update({ yearMax: num });
  }, [localYearMax, update]);

  // Filtered makes for search
  const visibleMakes = useMemo(() => {
    const available = TOP_MAKES.filter((m) => !filters.makes.includes(m));
    if (!makeSearch.trim()) return available;
    const q = makeSearch.trim().toUpperCase();
    return available.filter((m) => m.includes(q));
  }, [makeSearch, filters.makes]);

  // Active filter count
  const filterCount = useMemo(() => {
    let count = 0;
    if (filters.yearMin) count++;
    if (filters.yearMax) count++;
    if (filters.makes.length > 0) count += filters.makes.length;
    if (filters.bodyStyles.length > 0) count += filters.bodyStyles.length;
    if (filters.priceMin) count++;
    if (filters.priceMax) count++;
    if (filters.is4x4) count++;
    if (filters.forSale) count++;
    if (filters.hideSold) count++;
    if (filters.showSoldOnly) count++;
    if (filters.hasImages) count++;
    return count;
  }, [filters]);

  if (collapsed) {
    return (
      <div
        style={{
          width: '32px',
          flexShrink: 0,
          borderRight: '2px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: '8px',
          cursor: 'pointer',
          background: 'var(--surface)',
          position: 'sticky',
          top: 'var(--header-height, 42px)',
          alignSelf: 'flex-start',
          height: 'calc(100vh - var(--header-height, 42px))',
        }}
        onClick={onToggleCollapsed}
        title="Show filters"
      >
        <span style={{
          writingMode: 'vertical-rl',
          fontFamily: 'Arial, sans-serif',
          fontSize: '8px',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: 'var(--text-disabled)',
        }}>
          FILTERS {filterCount > 0 ? `(${filterCount})` : ''}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '220px',
        flexShrink: 0,
        borderRight: '2px solid var(--border)',
        padding: '0 10px',
        overflowY: 'auto',
        background: 'var(--surface)',
        fontSize: '9px',
        position: 'sticky',
        top: 'var(--header-height, 42px)',
        alignSelf: 'flex-start',
        height: 'calc(100vh - var(--header-height, 42px))',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 0', borderBottom: '2px solid var(--border)',
      }}>
        <span style={{
          fontFamily: 'Arial, sans-serif', fontSize: '9px', fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text)',
        }}>
          FILTERS {filterCount > 0 && (
            <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>({filterCount})</span>
          )}
        </span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetAll}
              style={{
                ...chipStyle,
                fontSize: '7px',
                color: 'var(--error)',
                borderColor: 'var(--error)',
                padding: '1px 4px',
              }}
            >
              RESET
            </button>
          )}
          {onToggleCollapsed && (
            <span
              onClick={onToggleCollapsed}
              style={{ cursor: 'pointer', fontSize: '10px', color: 'var(--text-disabled)' }}
              title="Collapse filters"
            >
              ◂
            </span>
          )}
        </div>
      </div>

      {/* YEAR */}
      <FilterSection title="YEAR">
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="number"
            placeholder="From"
            value={localYearMin}
            onChange={(e) => setLocalYearMin(e.target.value)}
            onBlur={commitYearMin}
            onKeyDown={(e) => { if (e.key === 'Enter') commitYearMin(); }}
            style={{ ...inputStyle, width: '50%' }}
            min={1886}
            max={2030}
          />
          <span style={{ color: 'var(--text-disabled)', fontSize: '8px' }}>—</span>
          <input
            type="number"
            placeholder="To"
            value={localYearMax}
            onChange={(e) => setLocalYearMax(e.target.value)}
            onBlur={commitYearMax}
            onKeyDown={(e) => { if (e.key === 'Enter') commitYearMax(); }}
            style={{ ...inputStyle, width: '50%' }}
            min={1886}
            max={2030}
          />
        </div>
      </FilterSection>

      {/* MAKE */}
      <FilterSection title="MAKE">
        {/* Selected makes */}
        {filters.makes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '6px' }}>
            {filters.makes.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => toggleMake(m)}
                style={{
                  ...chipActiveStyle,
                  fontSize: '7px',
                  padding: '1px 4px',
                }}
              >
                {m} ✕
              </button>
            ))}
          </div>
        )}
        {/* Search input */}
        <input
          type="text"
          placeholder="Type to filter..."
          value={makeSearch}
          onChange={(e) => setMakeSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const match = visibleMakes[0];
              if (match) toggleMake(match);
            }
          }}
          style={{ ...inputStyle, marginBottom: '6px', fontSize: '9px' }}
        />
        {/* Make grid */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
          {visibleMakes.map((make) => (
            <button
              key={make}
              type="button"
              onClick={() => toggleMake(make)}
              style={{
                ...chipStyle,
                fontSize: '7px',
                padding: '1px 4px',
              }}
            >
              {make}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* BODY STYLE */}
      <FilterSection title="BODY STYLE">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
          {BODY_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => toggleBodyStyle(style)}
              style={filters.bodyStyles.includes(style) ? {
                ...chipActiveStyle,
                fontSize: '7px',
                padding: '2px 5px',
              } : {
                ...chipStyle,
                fontSize: '7px',
                padding: '2px 5px',
              }}
            >
              {style}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* PRICE */}
      <FilterSection title="PRICE">
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="number"
            placeholder="Min $"
            value={filters.priceMin ?? ''}
            onChange={(e) => update({ priceMin: e.target.value ? Number(e.target.value) : null })}
            style={{ ...inputStyle, width: '50%' }}
            min={0}
            step={1000}
          />
          <span style={{ color: 'var(--text-disabled)', fontSize: '8px' }}>—</span>
          <input
            type="number"
            placeholder="Max $"
            value={filters.priceMax ?? ''}
            onChange={(e) => update({ priceMax: e.target.value ? Number(e.target.value) : null })}
            style={{ ...inputStyle, width: '50%' }}
            min={0}
            step={1000}
          />
        </div>
      </FilterSection>

      {/* STATUS */}
      <FilterSection title="STATUS">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
          <button
            type="button"
            onClick={() => update({ forSale: !filters.forSale, showSoldOnly: false, hideSold: false })}
            style={filters.forSale ? chipActiveStyle : chipStyle}
          >
            FOR SALE
          </button>
          <button
            type="button"
            onClick={() => update({ showSoldOnly: !filters.showSoldOnly, forSale: false, hideSold: false })}
            style={filters.showSoldOnly ? chipActiveStyle : chipStyle}
          >
            SOLD ONLY
          </button>
          <button
            type="button"
            onClick={() => update({ hideSold: !filters.hideSold, showSoldOnly: false })}
            style={filters.hideSold ? chipActiveStyle : chipStyle}
          >
            HIDE SOLD
          </button>
          <button
            type="button"
            onClick={() => update({ is4x4: !filters.is4x4 })}
            style={filters.is4x4 ? chipActiveStyle : chipStyle}
          >
            4X4 / AWD
          </button>
          <button
            type="button"
            onClick={() => update({ hasImages: !filters.hasImages })}
            style={filters.hasImages ? chipActiveStyle : chipStyle}
          >
            HAS PHOTOS
          </button>
          <button
            type="button"
            onClick={() => update({ dealer: !filters.dealer })}
            style={filters.dealer ? chipActiveStyle : chipStyle}
          >
            DEALERS
          </button>
        </div>
      </FilterSection>

      {/* SOURCES */}
      <FilterSection title="SOURCES" defaultOpen={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[
            { key: 'hideBat', label: 'BRING A TRAILER' },
            { key: 'hideCraigslist', label: 'CRAIGSLIST' },
            { key: 'hideKsl', label: 'KSL' },
            { key: 'hideClassic', label: 'CLASSIC.COM' },
            { key: 'hideDealerListings', label: 'DEALER LISTINGS' },
            { key: 'hideDealerSites', label: 'DEALER SITES' },
          ].map(({ key, label }) => (
            <label
              key={key}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
                textTransform: 'uppercase', color: 'var(--text-secondary)',
              }}
            >
              <input
                type="checkbox"
                checked={!filters[key as keyof FilterState]}
                onChange={() => update({ [key]: !filters[key as keyof FilterState] } as unknown as Partial<FilterState>)}
                style={{ accentColor: 'var(--text)' }}
              />
              {label}
            </label>
          ))}
        </div>
      </FilterSection>
    </div>
  );
}
