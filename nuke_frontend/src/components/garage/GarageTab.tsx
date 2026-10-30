/** The owner's garage, preserving recorded relationships and unresolved evidence. */
import React from 'react';
import Link from '../PrefetchLink';
import { Button } from '../ui/button';
import type { VehiclesDashboardState } from '../../hooks/useVehiclesDashboard';
import { GarageVehicleCard } from '../vehicles/GarageVehicleCard';
import { GarageToolbar } from './GarageToolbar';
import './garage.css';

function GarageContent({ dashboard }: { dashboard: VehiclesDashboardState }) {
  const { vehicles, isLoading, error, warnings = [], viewMode, sortMode, filterMode,
    setViewMode, setSortMode, setFilterMode, refresh, unresolvedSources = [], signedIn } = dashboard;
  const filtered = filterMode !== 'ALL';
  const groups = [
    { key: 'current', label: 'Current vehicles' },
    { key: 'previous', label: 'Previous vehicles' },
    { key: 'unknown', label: 'Other vehicle relationships' },
  ].map(group => ({ ...group, vehicles: vehicles.filter(vehicle => {
    const status = vehicle.inventory_status ??
      (['VERIFIED OWNER', 'OWNER', 'CO-OWNER'].includes(vehicle.relationship_type) ? 'current'
        : vehicle.relationship_type === 'PREVIOUSLY OWNED' ? 'previous' : 'unknown');
    return status === group.key;
  }) })).filter(group => group.vehicles.length > 0);

  return <main className="garage-page">
    <div className="garage-heading"><div><h1>Garage</h1><p>Your vehicle relationships and the evidence recorded for them.</p></div>
      {signedIn && <Button variant="secondary" type="button" disabled={isLoading} onClick={refresh}>{isLoading ? 'Reading garage…' : 'Refresh garage'}</Button>}
    </div>
    {signedIn && !isLoading && !error && <GarageToolbar vehicleCount={vehicles.length} viewMode={viewMode} sortMode={sortMode} filterMode={filterMode} onViewChange={setViewMode} onSortChange={setSortMode} onFilterChange={setFilterMode} />}
    {isLoading ? <div role="status" className="garage-notice">Reading vehicle relationships…</div>
      : error ? <section role="alert" className="garage-notice"><h2>Garage unavailable</h2><p>{error}</p><Button type="button" onClick={refresh}>Retry garage</Button></section>
      : <>
        {warnings.length > 0 && <section role="status" className="garage-notice"><h2>Some details are unavailable</h2><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><Button variant="secondary" type="button" onClick={refresh}>Retry details</Button></section>}
        {unresolvedSources.length > 0 && <section className="garage-unresolved"><h2>Identity pending <span>{unresolvedSources.length}</span></h2>
          {unresolvedSources.map(source => <article key={source.id}>
            <h3>{source.label}</h3><p>{source.stated_roles.map(role => role.replaceAll('_', ' ')).join(' · ')} · account stated</p>
            <p>Photo evidence still needs to identify this vehicle.</p>
            {source.source_excerpt && <details><summary>Source statement</summary><p>{source.source_excerpt}</p><p>Recorded <time dateTime={source.observed_at}>{source.observed_at.slice(0, 10)}</time></p></details>}
          </article>)}
        </section>}
        {vehicles.length === 0 && <section className="garage-empty"><h2>{filtered ? 'No matching vehicle records' : signedIn ? (unresolvedSources.length ? 'No identified vehicle records yet' : 'No vehicles yet') : 'Your garage'}</h2>
          <p>{filtered ? 'No loaded records match this relationship filter.' : signedIn ? (unresolvedSources.length ? 'The statements above are preserved while vehicle identity is unresolved.' : 'Add a vehicle to start building your garage.') : 'Sign in to see the vehicles you own and the records you hold for them.'}</p>
          <div className="garage-empty-actions">{filtered && <Button variant="secondary" type="button" onClick={() => setFilterMode('ALL')}>Clear filter</Button>}
            {(!signedIn || !unresolvedSources.length) && <Link className="btn-base btn-primary" to={signedIn ? '/vehicle/add' : '/login'}>{signedIn ? 'Add vehicle' : 'Sign in'}</Link>}
          </div>
        </section>}
        {vehicles.length > 0 && <p className="garage-relationship-note">Relationships reflect recorded ownership and account statements. Relationship changes are not available from this page.</p>}
        <div className="garage-sections">
          {groups.map(section => <section key={section.key} aria-label={section.label}>
            <h2 className="garage-section-heading">{section.label} <span>{section.vehicles.length}</span></h2>
            <div className={`garage-vehicles garage-view-${viewMode.toLowerCase()}`}>
              {section.vehicles.map(vehicle => <GarageVehicleCard key={vehicle.id} vehicle={vehicle} viewMode={viewMode} onRefresh={refresh} />)}
            </div>
          </section>)}
        </div>
      </>}
  </main>;
}

export default function GarageTab({ dashboard }: { dashboard: VehiclesDashboardState }) {
  return <GarageContent key={dashboard.viewerId ?? 'anonymous'} dashboard={dashboard} />;
}
