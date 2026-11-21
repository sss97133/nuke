/** The garage read as one record: how much is documented, how recently, and what is priced. */
import React, { useMemo } from 'react';
import { garageLastDay, type GarageVehicle, type SortMode } from '../../hooks/useVehiclesDashboard';
import { formatCurrency, garageAxis, MiniBarcode } from '../vehicles/GarageVehicleCard';

const count = (n: number) => n.toLocaleString('en-US');
const DAY_MS = 86_400_000;

export interface GarageTotals {
  cars: number; photos: number; workDays: number; events: number; documents: number;
  withVin: number; priced: number; classTotal: number; activeCars: number; lastDay: string | null;
  /** Every car's dated activity added together, one row per day. */
  days: [string, number, number, number, number][];
}

/** Totals over the loaded cars. `now` is passed in tests. */
export function garageTotals(vehicles: GarageVehicle[], now = Date.now()): GarageTotals {
  const totals: GarageTotals = { cars: vehicles.length, photos: 0, workDays: 0, events: 0, documents: 0, withVin: 0, priced: 0, classTotal: 0, activeCars: 0, lastDay: null, days: [] };
  const days = new Map<string, number>();
  const recent = new Date(now - 90 * DAY_MS).toISOString().slice(0, 10);
  for (const vehicle of vehicles) {
    const t = vehicle.timeline;
    // image_count also holds undated photos, so it is the photo total when it is larger.
    totals.photos += Math.max(t?.photos ?? 0, vehicle.image_count ?? 0);
    totals.workDays += t?.work_days ?? 0;
    totals.events += t?.events ?? vehicle.event_count ?? 0;
    totals.documents += t?.documents ?? 0;
    if (vehicle.vin?.trim()) totals.withVin += 1;
    const median = Number(vehicle.class_price?.value);
    if (Number.isFinite(median) && median > 0) { totals.priced += 1; totals.classTotal += median; }
    const last = garageLastDay(vehicle);
    if (last && last >= recent) totals.activeCars += 1;
    if (last && (!totals.lastDay || last > totals.lastDay)) totals.lastDay = last;
    for (const [day, photos, work, events, documents] of t?.days ?? []) {
      days.set(day, (days.get(day) ?? 0) + (Number(photos) || 0) + (Number(work) || 0) + (Number(events) || 0) + (Number(documents) || 0));
    }
  }
  totals.days = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => [day, n, 0, 0, 0]);
  return totals;
}

export function GarageSummary({ vehicles, sortMode, onSort }: { vehicles: GarageVehicle[]; sortMode: SortMode; onSort: (mode: SortMode) => void }) {
  const totals = useMemo(() => garageTotals(vehicles), [vehicles]);
  // The garage's own strip: the cards' squares, with every car's days added together and its own shading.
  const whole = useMemo(() => ({ timeline: { days: totals.days }, event_weeks: null } as unknown as GarageVehicle), [totals]);
  const axis = useMemo(() => garageAxis([whole]), [whole]);
  const activeDays = totals.days.filter(([day]) => { const at = Date.parse(`${day}T00:00:00Z`); return at >= axis.start && at <= axis.end; }).length;
  if (!totals.cars) return null;
  const of = (n: number) => `${count(n)} of ${count(totals.cars)} cars`;
  const tiles: { label: string; value: string; note?: string; sort?: SortMode }[] = [
    { label: 'Photos', value: count(totals.photos), sort: 'PHOTOS' },
    { label: 'Work days', value: count(totals.workDays), sort: 'WORK' },
    { label: 'Events', value: count(totals.events), sort: 'EVENTS' },
    { label: 'Document pages', value: count(totals.documents), sort: 'DOCS' },
    { label: 'Active in 90 days', value: count(totals.activeCars), note: `of ${count(totals.cars)} cars`, sort: 'RECENT' },
    { label: 'With a VIN', value: count(totals.withVin), note: `of ${count(totals.cars)} cars` },
    { label: 'Class medians added up', value: totals.priced ? formatCurrency(totals.classTotal) : 'None yet', note: `${of(totals.priced)} priced`, sort: 'CLASS' },
  ];
  return <section className="garage-summary" aria-label="Garage summary">
    <div className="garage-summary-record">
      <p><strong>{count(totals.cars)}</strong> {totals.cars === 1 ? 'car' : 'cars'} · <strong>{count(activeDays)}</strong> active {activeDays === 1 ? 'day' : 'days'} in the last year{totals.lastDay ? <> · last recorded <time dateTime={totals.lastDay}>{totals.lastDay}</time></> : null}</p>
      <MiniBarcode vehicle={whole} axis={axis} />
    </div>
    <dl className="garage-summary-tiles">
      {tiles.map(tile => {
        const body = <><dt>{tile.label}</dt><dd>{tile.value}{tile.note && <small>{tile.note}</small>}</dd></>;
        return tile.sort
          ? <button key={tile.label} type="button" aria-pressed={sortMode === tile.sort} title={`Order the cars by ${tile.label.toLowerCase()}`} onClick={() => onSort(tile.sort!)}>{body}</button>
          : <div key={tile.label}>{body}</div>;
      })}
    </dl>
  </section>;
}
