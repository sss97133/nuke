/** Feed sort, view and display settings. Shared by the feed and market pages. */
import { useId } from 'react';
import type { SortBy, SortDirection, ViewMode } from '../../types/feedTypes';
import type { ImageFit } from '../utils/feedUrlCodec';
import type { HeroDimension } from './HeroPanel';
import './FeedPage.css';

export interface FeedToolbarProps {
  sort: SortBy;
  direction: SortDirection;
  viewMode: ViewMode;
  cardsPerRow: number;
  fontSize: number;
  showScores: boolean;
  imageFit: ImageFit;
  /** Retained for callers; Finds recommendations have no live backing reader yet. */
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

// Finds is intentionally not offered: vehicle_finds and its feed view are absent
// in production (verified 2026-10-25; already documented by the 2026-09-27 feed migration).
// The URL codec still preserves legacy sort=finds so it never substitutes another score.
const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'popular', label: 'Rank' }, { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'deal_score', label: 'Deals' }, { value: 'heat_score', label: 'Heat' },
  { value: 'price_high', label: 'Price ↓' }, { value: 'price_low', label: 'Price ↑' },
  { value: 'year', label: 'Year' }, { value: 'mileage', label: 'Mileage' },
];
const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: 'grid', label: 'Grid' }, { value: 'gallery', label: 'List' }, { value: 'technical', label: 'Table' },
];
const FIT_CYCLE: ImageFit[] = ['auto', 'cover', 'contain'];
const FIT_LABELS: Record<ImageFit, string> = { auto: 'Auto', cover: 'Fill', contain: 'Full image' };
const SORT_HERO_MAP: Partial<Record<SortBy, HeroDimension>> = {
  newest: 'newest', deal_score: 'deal_score', heat_score: 'heat_score', year: 'year',
  price_high: 'price_high', price_low: 'price_low', mileage: 'mileage', finds: 'finds',
};

export function FeedToolbar({
  sort, direction, viewMode, cardsPerRow, fontSize, showScores, imageFit, activeHeroPanel,
  onSortChange, onDirectionChange, onViewModeChange, onCardsPerRowChange, onFontSizeChange,
  onToggleScores, onImageFitChange, onHeroPanelToggle,
}: FeedToolbarProps) {
  const id = useId();

  const chooseSort = (value: SortBy) => {
    const hero = SORT_HERO_MAP[value];
    if (sort === value && hero && onHeroPanelToggle) {
      onHeroPanelToggle(activeHeroPanel === hero ? null : hero);
    } else if (sort === value) {
      onDirectionChange(direction === 'asc' ? 'desc' : 'asc');
    } else {
      onSortChange(value);
      onHeroPanelToggle?.(hero ?? null);
    }
  };

  return (
    <div className="feed-toolbar">
      {viewMode !== 'technical' && <div className="feed-toolbar__sort" role="group" aria-label="Sort vehicles">
        <span className="feed-toolbar__label">Sort</span>
        {SORT_OPTIONS.map(opt => {
          const active = sort === opt.value;
          const hero = SORT_HERO_MAP[opt.value];
          const expanded = hero != null && activeHeroPanel === hero;
          return <button key={opt.value} type="button" className="feed-toolbar__chip"
            aria-pressed={active} aria-expanded={hero && onHeroPanelToggle ? expanded : undefined}
            onClick={() => chooseSort(opt.value)}>
            {opt.label}{active && (direction === 'asc' ? ' ↑' : ' ↓')}
          </button>;
        })}
      </div>}

      <div className="feed-toolbar__views" role="group" aria-label="Vehicle display">
        {VIEW_MODES.map(view => <button key={view.value} type="button" className="feed-toolbar__chip"
          aria-label={`${view.label} view`} aria-pressed={viewMode === view.value}
          onClick={() => onViewModeChange(view.value)}>{view.label}</button>)}
      </div>

      <details className="feed-toolbar__display">
        <summary>Display options</summary>
        <div className="feed-toolbar__options">
          <label className="feed-toolbar__range" htmlFor={`${id}-text`}>
            <span>Text size</span><output>{fontSize} px</output>
            <input id={`${id}-text`} type="range" min={8} max={18} value={fontSize}
              aria-label="Card text size" aria-valuetext={`${fontSize} pixels`}
              onChange={e => onFontSizeChange(Number(e.target.value))} />
          </label>
          {viewMode === 'grid' && <>
            <label className="feed-toolbar__range" htmlFor={`${id}-columns`}>
              <span>Columns</span><output>{cardsPerRow}</output>
              <input id={`${id}-columns`} type="range" min={1} max={12} value={cardsPerRow}
                aria-label="Vehicle columns" aria-valuetext={`${cardsPerRow} columns`}
                onChange={e => onCardsPerRowChange(Number(e.target.value))} />
            </label>
            <button type="button" className="btn-base btn-secondary"
              aria-label={`Image fit: ${FIT_LABELS[imageFit]}`}
              title="Cycle image fit: Auto, Fill, or Full image"
              onClick={() => onImageFitChange(FIT_CYCLE[(FIT_CYCLE.indexOf(imageFit) + 1) % FIT_CYCLE.length])}>
              Images: {FIT_LABELS[imageFit]}
            </button>
          </>}
          <button type="button" className="btn-base btn-secondary" aria-pressed={showScores}
            title="Show rank score breakdown on cards" onClick={onToggleScores}>
            {showScores ? 'Hide scores' : 'Show scores'}
          </button>
        </div>
      </details>
    </div>
  );
}
