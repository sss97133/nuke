/** The owner's garage, preserving recorded relationships and unresolved evidence. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from '../PrefetchLink';
import { Button } from '../ui/button';
import { garageFirstDay, garageLastDay, type GarageVehicle, type VehiclesDashboardState } from '../../hooks/useVehiclesDashboard';
import { GarageVehicleCard, garageAxis } from '../vehicles/GarageVehicleCard';
import { GarageToolbar } from './GarageToolbar';
import { GarageSummary } from './GarageSummary';
import { addFilesToVehicle, GarageCardMenu, GarageMergeBar, GarageSheetPanel, type GarageSheet } from './GarageCardActions';
import './garage.css';

const CARD_WIDTH_KEY = 'garage-card-width';
const CARD_WIDTH_DEFAULT = 280;
const CARD_WIDTH_MIN = 130;
const CARD_WIDTH_MAX = 720;

function GarageContent({ dashboard }: { dashboard: VehiclesDashboardState }) {
  const { vehicles, isLoading, error, warnings = [], viewMode, sortMode, filterMode,
    setViewMode, setSortMode, setFilterMode, refresh, unresolvedSources = [], signedIn } = dashboard;
  const [query, setQuery] = useState('');
  // A two-finger click on a card opens its actions; files dropped on a card go to that car.
  const [menu, setMenu] = useState<{ vehicle: GarageVehicle; x: number; y: number } | null>(null);
  // Any number of cars can have their agent or log book open at once; each stays on its own card.
  const [sheets, setSheets] = useState<Record<string, GarageSheet['kind']>>({});
  const setSheet = (sheet: GarageSheet) => setSheets(current => ({ ...current, [sheet.vehicle.id]: sheet.kind }));
  const closeSheet = (id: string) => setSheets(current => { const next = { ...current }; delete next[id]; return next; });
  const [merge, setMerge] = useState<{ keeper: GarageVehicle; duplicate: GarageVehicle | null } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const hasFiles = (event: React.DragEvent) => [...event.dataTransfer.types].includes('Files');
  // A pinch resizes the cards (more cars or bigger cars), not the browser's magnification.
  const pageRef = useRef<HTMLElement>(null);
  const [cardWidth, setCardWidth] = useState(() => {
    let saved = 0;
    try { saved = Number(globalThis.localStorage?.getItem?.(CARD_WIDTH_KEY)); } catch { /* storage unavailable */ }
    return saved >= CARD_WIDTH_MIN && saved <= CARD_WIDTH_MAX ? saved : CARD_WIDTH_DEFAULT;
  });
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const clamp = (width: number) => Math.round(Math.min(CARD_WIDTH_MAX, Math.max(CARD_WIDTH_MIN, width)));
    // A trackpad pinch arrives as a wheel event with ctrlKey set.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setCardWidth(width => clamp(width * Math.exp(-event.deltaY * 0.01)));
    };
    // Safari reports the pinch as gesture events carrying a scale.
    let base = CARD_WIDTH_DEFAULT;
    const onGestureStart = (event: Event) => { event.preventDefault(); setCardWidth(width => (base = width)); };
    const onGestureChange = (event: Event) => { event.preventDefault(); setCardWidth(clamp(base * ((event as any).scale || 1))); };
    page.addEventListener('wheel', onWheel, { passive: false });
    page.addEventListener('gesturestart', onGestureStart);
    page.addEventListener('gesturechange', onGestureChange);
    return () => {
      page.removeEventListener('wheel', onWheel);
      page.removeEventListener('gesturestart', onGestureStart);
      page.removeEventListener('gesturechange', onGestureChange);
    };
  }, []);
  useEffect(() => { try { globalThis.localStorage?.setItem?.(CARD_WIDTH_KEY, String(cardWidth)); } catch { /* private mode */ } }, [cardWidth]);
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
  // One window and one intensity scale for every strip, taken from the whole garage.
  const axis = useMemo(() => garageAxis(vehicles), [vehicles]);

  return <main className="garage-page" ref={pageRef} style={{ '--garage-card-min': `${cardWidth}px` } as React.CSSProperties}>
    <div className="garage-heading"><div><h1>Garage</h1><p>Every car you are tied to, in the order of its recorded activity.</p></div>
      {signedIn && <div className="garage-heading-actions">
        <Link className="btn-base btn-secondary" to="/capture/ledger">Capture ledger</Link>
        <Button variant="secondary" type="button" disabled={isLoading} onClick={refresh}>{isLoading ? 'Reading garage…' : 'Refresh garage'}</Button>
      </div>}
    </div>
    {signedIn && !isLoading && !error && <GarageSummary vehicles={vehicles} sortMode={sortMode} onSort={setSortMode} />}
    {signedIn && !isLoading && !error && <GarageToolbar vehicleCount={visibleVehicles.length} loadedVehicleCount={dashboard.loadedVehicleCount ?? vehicles.length} searchQuery={query} onSearchChange={setQuery} viewMode={viewMode} sortMode={sortMode} sortReversed={dashboard.sortReversed} filterMode={filterMode} onViewChange={setViewMode} onSortChange={setSortMode} onSortReverse={dashboard.setSortReversed} onFilterChange={setFilterMode} />}
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
              {section.vehicles.map(vehicle => <div key={vehicle.id} className="garage-card-slot"
                data-drop={dropOn === vehicle.id || undefined} data-merge-pick={merge && !merge.duplicate && merge.keeper.id !== vehicle.id || undefined}
                onContextMenu={event => {
                  if (!signedIn) return;
                  event.preventDefault();
                  // The bubble opens on the card, at the click, pulled in so it stays inside the card's width.
                  const box = event.currentTarget.getBoundingClientRect();
                  setMenu({ vehicle, x: Math.min(event.clientX - box.left, Math.max(4, box.width - 248)), y: event.clientY - box.top });
                }}
                onClickCapture={event => {
                  // While a merge is being set up, a press on a card names the duplicate instead of opening it.
                  if (!merge || merge.duplicate || merge.keeper.id === vehicle.id) return;
                  event.preventDefault(); event.stopPropagation(); setMerge({ keeper: merge.keeper, duplicate: vehicle });
                }}
                onDragOver={event => { if (!signedIn || !hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropOn(vehicle.id); }}
                onDragLeave={() => setDropOn(current => current === vehicle.id ? null : current)}
                onDrop={event => { if (!signedIn || !hasFiles(event)) return; event.preventDefault(); event.stopPropagation(); setDropOn(null); addFilesToVehicle(vehicle, [...event.dataTransfer.files]); }}>
                <GarageVehicleCard vehicle={vehicle} viewMode={viewMode} onRefresh={refresh} axis={axis} />
                {signedIn && !sheets[vehicle.id] && <button type="button" className="garage-card-corner" aria-label={`Open the agent for ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}`}
                  title="Open this car's agent" onClick={() => setSheet({ kind: 'agent', vehicle })} />}
                {menu?.vehicle.id === vehicle.id && <GarageCardMenu vehicle={vehicle} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onSheet={setSheet} onMerge={keeper => setMerge({ keeper, duplicate: null })} />}
                {sheets[vehicle.id] && <GarageSheetPanel key={sheets[vehicle.id]} sheet={{ kind: sheets[vehicle.id], vehicle }} onClose={() => closeSheet(vehicle.id)} />}
              </div>)}
            </div>
          </section>)}
        </div>
      </>}
    {merge && <GarageMergeBar keeper={merge.keeper} duplicate={merge.duplicate} viewerId={dashboard.viewerId} onCancel={() => setMerge(null)} onDone={() => { setMerge(null); refresh(); }} />}
  </main>;
}

export default function GarageTab({ dashboard }: { dashboard: VehiclesDashboardState }) {
  return <GarageContent key={dashboard.viewerId ?? 'anonymous'} dashboard={dashboard} />;
}
