/** The owner's garage, preserving recorded relationships and unresolved evidence. */
import React, { useState } from 'react';
import Link from '../PrefetchLink';
import { Button } from '../ui/button';
import { garageFirstDay, garageLastDay, type GarageVehicle, type VehiclesDashboardState } from '../../hooks/useVehiclesDashboard';
import { GarageVehicleCard } from '../vehicles/GarageVehicleCard';
import { GarageToolbar } from './GarageToolbar';
import './garage.css';

function GarageContent({ dashboard }: { dashboard: VehiclesDashboardState }) {
  const { vehicles, isLoading, error, warnings = [], viewMode, sortMode, filterMode,
    setViewMode, setSortMode, setFilterMode, refresh, unresolvedSources = [], signedIn } = dashboard;
  const [query, setQuery] = useState('');
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every(word => text.toLocaleLowerCase().includes(word));
  const visibleVehicles = vehicles.filter(vehicle => matches([
    vehicle.year, vehicle.make, vehicle.model, vehicle.trim, vehicle.vin, vehicle.relationship_type,
  ].filter(value => value != null).join(' ')));
  const visibleSources = unresolvedSources.filter(source => matches([source.label, ...source.stated_roles].join(' ')));
  const filtered = filterMode !== 'ALL' || words.length > 0;
  // One list in date order. A year heading marks where the order crosses a year;
  // a car with no dated activity comes after the dated ones. Custody and relationship
  // are labels on the card, not sections.
  const dayOf = sortMode === 'FIRST' ? garageFirstDay : sortMode === 'RECENT' ? garageLastDay : null;
  const groups: { key: string; label: string | null; vehicles: GarageVehicle[] }[] = [];
  for (const vehicle of visibleVehicles) {
    const key = dayOf ? dayOf(vehicle)?.slice(0, 4) ?? 'undated' : 'all';
    const last = groups[groups.length - 1];
    if (last?.key === key) last.vehicles.push(vehicle);
    else groups.push({ key, label: !dayOf ? null : key === 'undated' ? 'No dated activity' : key, vehicles: [vehicle] });
  }
  // Every strip spans the same months: the last three years, or less when the garage is younger.
  // A car whose record starts earlier stretches its own strip back to its first month.
  const firstMonths = vehicles.flatMap(vehicle => vehicle.timeline?.first_day ? [vehicle.timeline.first_day.slice(0, 7)] : []).sort();
  const today = new Date();
  const monthsBack = (n: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, 1)).toISOString().slice(0, 7);
  const axis = firstMonths.length
    ? { start: firstMonths[0] > monthsBack(35) ? firstMonths[0] : monthsBack(35), end: monthsBack(0) } : undefined;

  return <main className="garage-page">
    <div className="garage-heading"><div><h1>Garage</h1><p>Every car you are tied to, in the order of its recorded activity.</p></div>
      {signedIn && <div className="garage-heading-actions">
        <Link className="btn-base btn-secondary" to="/capture/ledger">Capture ledger</Link>
        <Button variant="secondary" type="button" disabled={isLoading} onClick={refresh}>{isLoading ? 'Reading garage…' : 'Refresh garage'}</Button>
      </div>}
    </div>
    {signedIn && !isLoading && !error && <GarageToolbar vehicleCount={visibleVehicles.length} loadedVehicleCount={dashboard.loadedVehicleCount ?? vehicles.length} searchQuery={query} onSearchChange={setQuery} viewMode={viewMode} sortMode={sortMode} filterMode={filterMode} onViewChange={setViewMode} onSortChange={setSortMode} onFilterChange={setFilterMode} />}
    {isLoading ? <div role="status" className="garage-notice">Reading vehicle relationships…</div>
      : error ? <section role="alert" className="garage-notice"><h2>Garage unavailable</h2><p>{error}</p><Button type="button" onClick={refresh}>Retry garage</Button></section>
      : <>
        {warnings.length > 0 && <section role="status" className="garage-notice"><h2>Some details are unavailable</h2><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><Button variant="secondary" type="button" onClick={refresh}>Retry details</Button></section>}
        {visibleSources.length > 0 && <section className="garage-unresolved"><h2>Identity pending <span>{visibleSources.length === unresolvedSources.length ? visibleSources.length : `${visibleSources.length} of ${unresolvedSources.length}`}</span></h2>
          {visibleSources.map(source => <article key={source.id}>
            <h3>{source.label}</h3><p>{source.stated_roles.map(role => role.replaceAll('_', ' ')).join(' · ')} · account stated</p>
            <p>Photo evidence still needs to identify this vehicle.</p>
            {source.source_excerpt && <details><summary>Source statement</summary><p>{source.source_excerpt}</p><p>Recorded <time dateTime={source.observed_at}>{source.observed_at.slice(0, 10)}</time></p></details>}
          </article>)}
        </section>}
        {visibleVehicles.length === 0 && <section className="garage-empty"><h2>{filtered ? 'No matching vehicle records' : signedIn ? (unresolvedSources.length ? 'No identified vehicle records yet' : 'No vehicles yet') : 'Your garage'}</h2>
          <p>{filtered ? 'No loaded records match the current vehicle search and relationship filter.' : signedIn ? (unresolvedSources.length ? 'The statements above are preserved while vehicle identity is unresolved.' : 'Add a vehicle to start building your garage.') : 'Sign in to see the vehicles you own and the records you hold for them.'}</p>
          <div className="garage-empty-actions">{filterMode !== 'ALL' && <Button variant="secondary" type="button" onClick={() => setFilterMode('ALL')}>Clear filter</Button>}
            {words.length > 0 && <Button variant="secondary" type="button" onClick={() => setQuery('')}>Clear search</Button>}
            {!filtered && (!signedIn || !unresolvedSources.length) && <Link className="btn-base btn-primary" to={signedIn ? '/vehicle/add' : '/login'}>{signedIn ? 'Add vehicle' : 'Sign in'}</Link>}
          </div>
        </section>}
        {vehicles.length > 0 && <p className="garage-relationship-note">Relationships reflect recorded ownership and account statements. Relationship changes are not available from this page.</p>}
        <div className="garage-sections">
          {groups.map(section => <section key={section.key} aria-label={section.label ?? 'Vehicles'}>
            {section.label && <h2 className="garage-section-heading">{section.label} <span>{section.vehicles.length}</span></h2>}
            <div className={`garage-vehicles garage-view-${viewMode.toLowerCase()}`}>
              {section.vehicles.map(vehicle => <GarageVehicleCard key={vehicle.id} vehicle={vehicle} viewMode={viewMode} onRefresh={refresh} axis={axis} />)}
            </div>
          </section>)}
        </div>
      </>}
  </main>;
}

export default function GarageTab({ dashboard }: { dashboard: VehiclesDashboardState }) {
  return <GarageContent key={dashboard.viewerId ?? 'anonymous'} dashboard={dashboard} />;
}
