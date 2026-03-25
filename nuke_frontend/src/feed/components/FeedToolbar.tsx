/**
 * FeedToolbar — Sort, view mode, density, and display controls.
 *
 * Sits above the feed grid. Compact, terminal-aesthetic.
 * Now includes font size and badge toggles for user control.
 */

import { useMemo, type CSSProperties } from 'react';
import type { SortBy, SortDirection, ViewMode } from '../../types/feedTypes';
import type { ImageFit } from '../utils/feedUrlCodec';
import type { HeroDimension } from './HeroPanel';

export interface FeedToolbarProps {
  sort: SortBy;
  direction: SortDirection;
  viewMode: ViewMode;
  cardsPerRow: number;
  fontSize: number;
  showScores: boolean;
  imageFit: ImageFit;
  /** Whether user has recorded interests (enables FOR YOU sort) */
  hasInterests?: boolean;
  /** Currently open hero panel dimension (for highlight state) */
  activeHeroPanel?: HeroDimension | null;
  onSortChange: (sort: SortBy) => void;
  onDirectionChange: (dir: SortDirection) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onCardsPerRowChange: (n: number) => void;
  onFontSizeChange: (n: number) => void;
  onToggleScores: () => void;
  onImageFitChange: (fit: ImageFit) => void;
  /** Called when a sort button is clicked that has a hero panel dimension */
  onHeroPanelToggle?: (dimension: HeroDimension | null) => void;
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

const FIT_CYCLE: ImageFit[] = ['auto', 'cover', 'contain'];
const FIT_LABELS: Record<ImageFit, string> = {
  auto: 'FIT: AUTO',
  cover: 'FIT: FILL',
  contain: 'FIT: FULL',
};

// Map sort values to hero dimensions
const SORT_HERO_MAP: Partial<Record<SortBy, HeroDimension>> = {
  newest: 'newest',
  deal_score: 'deal_score',
  heat_score: 'heat_score',
  year: 'year',
  price_high: 'price_high',
  price_low: 'price_low',
  mileage: 'mileage',
  finds: 'finds',
};

export function FeedToolbar({
  sort,
  direction,
  viewMode,
  cardsPerRow,
  fontSize,
  showScores,
  imageFit,
  hasInterests,
  activeHeroPanel,
  onSortChange,
  onDirectionChange,
  onViewModeChange,
  onCardsPerRowChange,
  onFontSizeChange,
  onToggleScores,
  onImageFitChange,
  onHeroPanelToggle,
}: FeedToolbarProps) {
  const isTableView = viewMode === 'technical';

  // Build sort options — replace FINDS with FOR YOU when user has interests
  const sortOptions = useMemo(() => {
    if (hasInterests) {
      return SORT_OPTIONS.map((opt) =>
        opt.value === 'finds' ? { value: 'finds' as SortBy, label: 'FOR YOU' } : opt,
      );
    }
    return SORT_OPTIONS;
  }, [hasInterests]);

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
      {/* Sort chips — hidden in table view (columns are clickable) */}
      {!isTableView && (
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
          <span style={{
            fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
            textTransform: 'uppercase', color: 'var(--text-disabled)', marginRight: '4px',
          }}>
            SORT
          </span>
          {sortOptions.map((opt) => {
            const heroDim = SORT_HERO_MAP[opt.value];
            const isHeroActive = activeHeroPanel != null && heroDim === activeHeroPanel;
            const isActive = sort === opt.value;

            // Hero panel indicator bar
            const heroIndicator: CSSProperties = isHeroActive
              ? { borderBottom: '2px solid var(--text)', paddingBottom: '3px' }
              : {};

            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  if (isActive && heroDim && onHeroPanelToggle) {
                    // Already on this sort -- toggle hero panel
                    if (isHeroActive) {
                      onHeroPanelToggle(null);
                    } else {
                      onHeroPanelToggle(heroDim);
                    }
                  } else if (isActive) {
                    onDirectionChange(direction === 'asc' ? 'desc' : 'asc');
                  } else {
                    onSortChange(opt.value);
                    // Open hero panel for the new sort
                    if (heroDim && onHeroPanelToggle) {
                      onHeroPanelToggle(heroDim);
                    } else if (onHeroPanelToggle) {
                      onHeroPanelToggle(null);
                    }
                  }
                }}
                style={{
                  ...(isActive ? chipActive : chipBase),
                  ...heroIndicator,
                }}
              >
                {opt.label}
                {isActive && (direction === 'asc' ? ' \u2191' : ' \u2193')}
              </button>
            );
          })}
        </div>
      )}

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

      {/* Image fit cycle (grid mode only) */}
      {viewMode === 'grid' && (
        <button
          type="button"
          onClick={() => {
            const idx = FIT_CYCLE.indexOf(imageFit);
            onImageFitChange(FIT_CYCLE[(idx + 1) % FIT_CYCLE.length]);
          }}
          style={{ ...chipBase, fontSize: '7px' }}
          title="Cycle image fit: Auto (smart), Fill (crop to fill), Full (show entire image)"
        >
          {FIT_LABELS[imageFit]}
        </button>
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
