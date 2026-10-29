import React, { useId } from 'react';
import type { VehicleFilters } from '../../hooks/useSearchPage';

const DEFAULT_FILTERS: VehicleFilters = {
  make: '', priceMin: '', priceMax: '', yearMin: '', yearMax: '',
  mileageMax: '', transmission: '', listingStatus: '', showFilters: true,
};

interface Props {
  filters: VehicleFilters;
  onChange: (filters: VehicleFilters) => void;
  vehicleCount: number;
  displayVehicleCount: number;
  hideToggle?: boolean;
}

const inputStyle: React.CSSProperties = {
  padding: '8px',
  border: '1px solid var(--border)', background: 'var(--surface)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--text-secondary)',
  marginBottom: '4px',
};

export const SearchFilterPanel: React.FC<Props> = ({ filters, onChange, vehicleCount, displayVehicleCount, hideToggle = false }) => {
  const fieldsId = useId();
  const set = (patch: Partial<VehicleFilters>) => onChange({ ...filters, ...patch });
  const activeCount = [
    filters.make, filters.priceMin, filters.priceMax,
    filters.yearMin, filters.yearMax, filters.mileageMax,
    filters.transmission, filters.listingStatus,
  ].filter(Boolean).length;

  return (
    <section className="search-filter-panel" aria-label="Filter loaded vehicle records">
      <div style={{ padding: '12px', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!hideToggle && <button type="button" aria-expanded={filters.showFilters} aria-controls={fieldsId} onClick={() => set({ showFilters: !filters.showFilters })} style={{
              padding: '4px 10px', fontSize: 'var(--text-callout)', fontWeight: 700,
              border: '1px solid var(--border)', cursor: 'pointer',
              background: filters.showFilters ? 'var(--action)' : 'var(--surface)',
              color: filters.showFilters ? 'var(--on-action)' : 'var(--text)',
            }}>
              Filters{activeCount > 0 ? ` (${activeCount})` : ''}
            </button>}
            {activeCount > 0 && (
              <button type="button" onClick={() => set({ ...DEFAULT_FILTERS, showFilters: filters.showFilters })} style={{
                padding: '4px 8px', fontSize: 'var(--text-caption)', fontWeight: 600,
                border: '1px solid var(--text-muted)', background: 'var(--surface)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}>
                Clear all
              </button>
            )}
          </div>
          {!hideToggle && <div style={{ fontSize: 'var(--text-callout)', color: 'var(--text-secondary)' }}>
            {activeCount > 0
              ? `${displayVehicleCount} of ${vehicleCount} loaded vehicles match`
              : `${vehicleCount} loaded vehicle${vehicleCount === 1 ? '' : 's'}`}
          </div>}
        </div>

        {filters.showFilters && (
          <div id={fieldsId} className="search-filter-fields">
            <div>
              <div style={labelStyle}>Make</div>
              <input type="text" aria-label="Make" placeholder="e.g. Porsche" value={filters.make}
                onChange={e => set({ make: e.target.value })} style={{ ...inputStyle, width: '110px' }} />
            </div>

            <div>
              <div style={labelStyle}>Price ($)</div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input type="number" aria-label="Minimum recorded price" placeholder="Min" value={filters.priceMin} min={0}
                  onChange={e => set({ priceMin: e.target.value })} style={{ ...inputStyle, width: '80px' }} />
                <span style={{ fontSize: 'var(--text-callout)', color: 'var(--text-muted)' }}>&ndash;</span>
                <input type="number" aria-label="Maximum recorded price" placeholder="Max" value={filters.priceMax} min={0}
                  onChange={e => set({ priceMax: e.target.value })} style={{ ...inputStyle, width: '80px' }} />
              </div>
            </div>

            <div>
              <div style={labelStyle}>Year</div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input type="number" aria-label="Earliest year" placeholder="From" value={filters.yearMin} min={1886}
                  onChange={e => set({ yearMin: e.target.value })} style={{ ...inputStyle, width: '68px' }} />
                <span style={{ fontSize: 'var(--text-callout)', color: 'var(--text-muted)' }}>&ndash;</span>
                <input type="number" aria-label="Latest year" placeholder="To" value={filters.yearMax} min={1886}
                  onChange={e => set({ yearMax: e.target.value })} style={{ ...inputStyle, width: '68px' }} />
              </div>
            </div>

            <div>
              <div style={labelStyle}>Max Mileage</div>
              <input type="number" aria-label="Maximum mileage" placeholder="e.g. 50000" value={filters.mileageMax} min={0}
                onChange={e => set({ mileageMax: e.target.value })} style={{ ...inputStyle, width: '100px' }} />
            </div>

            <div>
              <div style={labelStyle}>Transmission</div>
              <select aria-label="Transmission" value={filters.transmission} onChange={e => set({ transmission: e.target.value })}
                style={{ ...inputStyle, padding: '4px 8px', cursor: 'pointer' }}>
                <option value="">Any</option>
                <option value="automatic">Automatic</option>
                <option value="manual">Manual</option>
              </select>
            </div>

            <div>
              <div style={labelStyle}>Recorded status</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[
                  { val: '', label: 'All' },
                  { val: 'for_sale', label: 'For Sale' },
                  { val: 'sold', label: 'Sold' },
                ].map(opt => (
                  <button key={opt.val} type="button" aria-pressed={filters.listingStatus === opt.val} onClick={() => set({ listingStatus: opt.val })} style={{
                    padding: '4px 8px', fontSize: 'var(--text-callout)', fontWeight: 700,
                    border: '1px solid var(--border)', cursor: 'pointer',
                    background: filters.listingStatus === opt.val ? 'var(--action)' : 'var(--surface)',
                    color: filters.listingStatus === opt.val ? 'var(--on-action)' : 'var(--text)',
                  }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
