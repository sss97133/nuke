/**
 * FeedToolbar — Sort, view mode, density, and display controls.
 *
 * Sits above the feed grid. Compact, terminal-aesthetic.
 * Now includes font size and badge toggles for user control.
 */

import type { CSSProperties } from 'react';
import type { SortBy, SortDirection, ViewMode } from '../../types/feedTypes';

export interface FeedToolbarProps {
  sort: SortBy;
  direction: SortDirection;
  viewMode: ViewMode;
  cardsPerRow: number;
  fontSize: number;
  showScores: boolean;
  onSortChange: (sort: SortBy) => void;
  onDirectionChange: (dir: SortDirection) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onCardsPerRowChange: (n: number) => void;
  onFontSizeChange: (n: number) => void;
  onToggleScores: () => void;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'popular', label: 'RANK' },
  { value: 'newest', label: 'NEWEST' },
  { value: 'oldest', label: 'OLDEST' },
  { value: 'finds', label: 'FINDS' },
  { value: 'deal_score', label: 'DEALS' },
  { value: 'heat_score', label: 'HEAT' },
  { value: 'price_high', label: 'PRICE \u2193' },
  { value: 'price_low', label: 'PRICE \u2191' },
  { value: 'year', label: 'YEAR' },
  { value: 'mileage', label: 'MILES' },
];

const VIEW_MODES: { value: ViewMode; label: string; title: string }[] = [
  { value: 'grid', label: '\u25a6', title: 'Grid' },
  { value: 'gallery', label: '\u2630', title: 'List' },
  { value: 'technical', label: '\u25a4', title: 'Table' },
];

const chipBase: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  padding: '5px 8px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
};

const chipActive: CSSProperties = {
  ...chipBase,
  borderColor: 'var(--text)',
  color: 'var(--text)',
  background: 'var(--surface-hover)',
};

export function FeedToolbar({
  sort,
  direction,
  viewMode,
  cardsPerRow,
  fontSize,
  showScores,
  onSortChange,
  onDirectionChange,
  onViewModeChange,
  onCardsPerRowChange,
  onFontSizeChange,
  onToggleScores,
}: FeedToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 0',
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      {/* Sort chips */}
      <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
        <span style={{
          fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
          textTransform: 'uppercase', color: 'var(--text-disabled)', marginRight: '4px',
        }}>
          SORT
        </span>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (sort === opt.value) {
                onDirectionChange(direction === 'asc' ? 'desc' : 'asc');
              } else {
                onSortChange(opt.value);
              }
            }}
            style={sort === opt.value ? chipActive : chipBase}
          >
            {opt.label}
            {sort === opt.value && (direction === 'asc' ? ' \u2191' : ' \u2193')}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Font size control */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
        <span style={{
          fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 700,
          color: 'var(--text-disabled)', textTransform: 'uppercase',
        }}>
          Aa
        </span>
        <input
          type="range"
          min={7}
          max={14}
          value={fontSize}
          onChange={(e) => onFontSizeChange(Number(e.target.value))}
          style={{ width: '50px', accentColor: 'var(--text-secondary)' }}
          title={`Font size: ${fontSize}px`}
        />
      </div>

      {/* Density slider (grid mode only) */}
      {viewMode === 'grid' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: '9px',
            color: 'var(--text-secondary)', minWidth: '16px', textAlign: 'right',
          }}>
            {cardsPerRow}
          </span>
          <input
            type="range"
            min={3}
            max={12}
            value={cardsPerRow}
            onChange={(e) => onCardsPerRowChange(Number(e.target.value))}
            style={{ width: '70px', accentColor: 'var(--text-secondary)' }}
            title={`${cardsPerRow} columns`}
          />
        </div>
      )}

      {/* Score transparency toggle */}
      <button
        type="button"
        onClick={onToggleScores}
        style={showScores ? { ...chipActive, fontSize: '7px' } : { ...chipBase, fontSize: '7px' }}
        title="Show rank score breakdown on cards"
      >
        {showScores ? 'SCORES ON' : 'SCORES'}
      </button>

      {/* View mode toggles */}
      <div style={{ display: 'flex', gap: '2px' }}>
        {VIEW_MODES.map((vm) => (
          <button
            key={vm.value}
            type="button"
            onClick={() => onViewModeChange(vm.value)}
            style={{
              ...(viewMode === vm.value ? chipActive : chipBase),
              fontSize: '12px',
              padding: '2px 6px',
            }}
            title={vm.title}
          >
            {vm.label}
          </button>
        ))}
      </div>
    </div>
  );
}
