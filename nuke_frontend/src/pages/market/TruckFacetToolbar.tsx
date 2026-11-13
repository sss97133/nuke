import { TRUCK_AXES, TRUCK_AXIS_LABELS, type TruckAxis, type TruckFilters } from './truckFacets';
import './TruckFacetToolbar.css';

export default function TruckFacetToolbar({ axis, filters, count, total, usd, pending, onGroup, onRemove, onClear }: {
  pending?: boolean; axis: TruckAxis | 'vehicles'; filters: TruckFilters; count: number; total: number; usd: number;
  onGroup: (axis: TruckAxis | 'vehicles') => void; onRemove: (axis: TruckAxis) => void; onClear: () => void;
}) {
  return <section className="truck-facets" aria-label="Truck market navigation">
    <div className="truck-facets__groups" role="group" aria-label="Group truck map by">
      <span className="truck-facets__label">Group by</span>
      {TRUCK_AXES.map(a => <button key={a} type="button" aria-pressed={axis === a} onClick={() => onGroup(a)}>{TRUCK_AXIS_LABELS[a]}</button>)}
      <button type="button" aria-pressed={axis === 'vehicles'} onClick={() => onGroup('vehicles')}>Vehicles</button>
    </div>
    <div className="truck-facets__selection" aria-live="polite">
      {TRUCK_AXES.filter(a => filters[a]).map(a => <button type="button" key={a} onClick={() => onRemove(a)} aria-label={`Remove ${TRUCK_AXIS_LABELS[a]} filter: ${filters[a]}`}>{TRUCK_AXIS_LABELS[a]}: {filters[a]} ×</button>)}
      {Object.keys(filters).length > 0 && <button type="button" onClick={onClear}>Clear filters</button>}
      <span>{pending ? 'Reading complete Truck membership…' : `${count.toLocaleString()} of ${total.toLocaleString()} priced sale records · $${usd.toLocaleString()}`}</span>
    </div>
    <p>Click a tile to filter. Change grouping to divide that selection. Area = sale dollars, all years. Groups use recorded specifications and source claims. Current configuration and configuration at sale may remain unverified.</p>
  </section>;
}
