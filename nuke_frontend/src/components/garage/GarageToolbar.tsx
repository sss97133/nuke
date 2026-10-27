/** Controls for the existing garage reader. */
import React from 'react';
import Link from '../PrefetchLink';
import type { ViewMode, SortMode, FilterMode } from '../../hooks/useVehiclesDashboard';

interface GarageToolbarProps {
  vehicleCount: number;
  viewMode: ViewMode;
  sortMode: SortMode;
  filterMode: FilterMode;
  onViewChange: (v: ViewMode) => void;
  onSortChange: (v: SortMode) => void;
  onFilterChange: (v: FilterMode) => void;
}

export function GarageToolbar({ vehicleCount, viewMode, sortMode, filterMode, onViewChange, onSortChange, onFilterChange }: GarageToolbarProps) {
  return <section className="garage-toolbar" aria-label="Garage controls">
    <div className="garage-toolbar-heading"><p>{vehicleCount} loaded {vehicleCount === 1 ? 'vehicle record' : 'vehicle records'} shown</p><Link className="btn-base btn-primary" to="/vehicle/add">Add vehicle</Link></div>
    <div className="garage-toolbar-fields">
      <div><span id="garage-view-label">View</span><div className="garage-segments" role="group" aria-labelledby="garage-view-label">
        {(['GRID', 'LIST', 'COMPACT'] as const).map(mode => <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => onViewChange(mode)}>{mode === 'GRID' ? 'Grid' : mode === 'LIST' ? 'List' : 'Compact'}</button>)}
      </div></div>
      <label>Sort<select value={sortMode} onChange={event => onSortChange(event.target.value as SortMode)}>
        <option value="RECENT">Recently updated</option><option value="VALUE">Recorded estimate</option><option value="NAME">Vehicle name</option>
      </select></label>
      <label>Relationship<select value={filterMode} onChange={event => onFilterChange(event.target.value as FilterMode)}>
        <option value="ALL">All relationships</option><option value="OWNED">Ownership records, current and past</option>
      </select></label>
    </div>
  </section>;
}
