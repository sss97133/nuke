/** Controls for the existing garage reader. */
import React from 'react';
import Link from '../PrefetchLink';
import type { ViewMode, SortMode, FilterMode } from '../../hooks/useVehiclesDashboard';

interface GarageToolbarProps {
  vehicleCount: number;
  loadedVehicleCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  viewMode: ViewMode;
  sortMode: SortMode;
  sortReversed?: boolean;
  filterMode: FilterMode;
  onViewChange: (v: ViewMode) => void;
  onSortChange: (v: SortMode) => void;
  onSortReverse?: (reversed: boolean) => void;
  onFilterChange: (v: FilterMode) => void;
}

/** Every order the loaded garage can be put in, grouped by what it reads. */
export const GARAGE_SORTS: { group: string; options: [SortMode, string][] }[] = [
  { group: 'Activity', options: [['RECENT', 'Latest activity'], ['FIRST', 'First on record'], ['DAYS', 'Most active days']] },
  { group: 'Record', options: [['PHOTOS', 'Most photos'], ['WORK', 'Most work days'], ['EVENTS', 'Most events'], ['DOCS', 'Most document pages']] },
  { group: 'Car', options: [['YEAR', 'Model year'], ['MAKE', 'Make and model'], ['NAME', 'Vehicle name'], ['ADDED', 'Date added'], ['OWNED', 'Owned since']] },
  { group: 'Price', options: [['CLASS', 'Class median'], ['VALUE', 'Recorded estimate']] },
];

export function GarageToolbar({ vehicleCount, loadedVehicleCount, searchQuery, onSearchChange, viewMode, sortMode, sortReversed = false, filterMode, onViewChange, onSortChange, onSortReverse, onFilterChange }: GarageToolbarProps) {
  return <section className="garage-toolbar" aria-label="Garage controls">
    <input className="garage-search" type="search" aria-label="Find vehicle or VIN" value={searchQuery} onChange={event => onSearchChange(event.target.value)} placeholder="Find a vehicle or VIN" />
    <div className="garage-sort">
      <select aria-label="Sort" value={sortMode} onChange={event => onSortChange(event.target.value as SortMode)}>
        {GARAGE_SORTS.map(({ group, options }) => <optgroup key={group} label={group}>
          {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </optgroup>)}
      </select>
      {onSortReverse && <button type="button" aria-pressed={sortReversed} aria-label="Reverse the order" title="Reverse the order" onClick={() => onSortReverse(!sortReversed)}>{sortReversed ? '↑' : '↓'}</button>}
    </div>
    <select aria-label="Relationship" value={filterMode} onChange={event => onFilterChange(event.target.value as FilterMode)}>
      <option value="ALL">All relationships</option><option value="OWNED">Ownership records, current and past</option>
    </select>
    <div className="garage-segments" role="group" aria-label="View">
      {(['GRID', 'LIST', 'COMPACT'] as const).map(mode => <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => onViewChange(mode)}>{mode === 'GRID' ? 'Grid' : mode === 'LIST' ? 'List' : 'Compact'}</button>)}
    </div>
    <Link className="btn-base btn-secondary" to="/vehicle/add">Add vehicle</Link>
    {vehicleCount !== loadedVehicleCount && <p className="garage-toolbar-heading">{vehicleCount} of {loadedVehicleCount} loaded {loadedVehicleCount === 1 ? 'vehicle record' : 'vehicle records'} shown</p>}
  </section>;
}
