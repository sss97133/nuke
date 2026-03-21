import React from 'react';
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
}

const inputStyle: React.CSSProperties = {
  padding: '4px 6px', fontSize: '11px',
  border: '2px solid var(--text)', background: 'var(--surface)',
};

const labelStyle: React.CSSProperties = {
  fontSize: '9px', fontWeight: 700, color: 'var(--text-secondary)',
  marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px',
};

export const SearchFilterPanel: React.FC<Props> = ({ filters, onChange, vehicleCount, displayVehicleCount }) => {
  const set = (patch: Partial<VehicleFilters>) => onChange({ ...filters, ...patch });
  const activeCount = [
    filters.make, filters.priceMin, filters.priceMax,
    filters.yearMin, filters.yearMax, filters.mileageMax,
    filters.transmission, filters.listingStatus,
  ].filter(Boolean).length;

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ padding: '10px 14px', background: 'var(--surface)', border: '2px solid var(--text)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button type="button" onClick={() => set({ showFilters: !filters.showFilters })} style={{
              padding: '4px 10px', fontSize: '11px', fontWeight: 700,
              border: '2px solid var(--text)', cursor: 'pointer',
              background: filters.showFilters ? 'var(--text)' : 'var(--surface)',
              color: filters.showFilters ? 'var(--surface)' : 'var(--text)',
            }}>
              Filters{activeCount > 0 ? ` (${activeCount})` : ''}
            </button>
            {activeCount > 0 && (
              <button type="button" onClick={() => set({ ...DEFAULT_FILTERS, showFilters: filters.showFilters })} style={{
                padding: '4px 8px', fontSize: '9px', fontWeight: 700,
                border: '1px solid var(--text-muted)', background: 'var(--surface)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}>
                Clear all
              </button>
            )}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            {activeCount > 0
              ? `${displayVehicleCount} of ${vehicleCount} vehicles match filters`
              : `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'}`}
          </div>
        </div>

        {filters.showFilters && (
          <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
            <div>
              <div style={labelStyle}>Make</div>
              <input type="text" placeholder="e.g. Porsche" value={filters.make}
                onChange={e => set({ make: e.target.value })} style={{ ...inputStyle, width: '110px' }} />
            </div>

            <div>
              <div style={labelStyle}>Price ($)</div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input type="number" placeholder="Min" value={filters.priceMin} min={0}
                  onChange={e => set({ priceMin: e.target.value })} style={{ ...inputStyle, width: '80px' }} />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>&ndash;</span>
                <input type="number" placeholder="Max" value={filters.priceMax} min={0}
                  onChange={e => set({ priceMax: e.target.value })} style={{ ...inputStyle, width: '80px' }} />
              </div>
            </div>

            <div>
              <div style={labelStyle}>Year</div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input type="number" placeholder="From" value={filters.yearMin} min={1886}
                  onChange={e => set({ yearMin: e.target.value })} style={{ ...inputStyle, width: '68px' }} />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>&ndash;</span>
                <input type="number" placeholder="To" value={filters.yearMax} min={1886}
                  onChange={e => set({ yearMax: e.target.value })} style={{ ...inputStyle, width: '68px' }} />
              </div>
            </div>

            <div>
              <div style={labelStyle}>Max Mileage</div>
              <input type="number" placeholder="e.g. 50000" value={filters.mileageMax} min={0}
                onChange={e => set({ mileageMax: e.target.value })} style={{ ...inputStyle, width: '100px' }} />
            </div>

            <div>
              <div style={labelStyle}>Transmission</div>
              <select value={filters.transmission} onChange={e => set({ transmission: e.target.value })}
                style={{ ...inputStyle, padding: '4px 8px', cursor: 'pointer' }}>
                <option value="">Any</option>
                <option value="automatic">Automatic</option>
                <option value="manual">Manual</option>
              </select>
            </div>

            <div>
              <div style={labelStyle}>Status</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[
                  { val: '', label: 'All' },
                  { val: 'for_sale', label: 'For Sale' },
                  { val: 'sold', label: 'Sold' },
                ].map(opt => (
                  <button key={opt.val} type="button" onClick={() => set({ listingStatus: opt.val })} style={{
                    padding: '4px 8px', fontSize: '11px', fontWeight: 700,
                    border: '2px solid var(--text)', cursor: 'pointer',
                    background: filters.listingStatus === opt.val ? 'var(--text)' : 'var(--surface)',
                    color: filters.listingStatus === opt.val ? 'var(--surface)' : 'var(--text)',
                  }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
