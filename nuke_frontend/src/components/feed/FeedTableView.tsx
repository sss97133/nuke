import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { HypeVehicle, SortBy, SortDirection } from '../../types/feedTypes';

interface FeedTableViewProps {
  vehicles: HypeVehicle[];
  sortBy: SortBy;
  sortDirection: SortDirection;
  setSortBy: (s: SortBy) => void;
  setSortDirection: (d: SortDirection) => void;
}

const thStyle: React.CSSProperties = {
  padding: '8px',
  cursor: 'pointer',
  fontWeight: 'bold',
  borderRight: '1px solid var(--border)',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

function SortHeader({
  label, field, sortBy, sortDirection, setSortBy, setSortDirection, align = 'left',
  priceField,
}: {
  label: string;
  field: SortBy;
  sortBy: SortBy;
  sortDirection: SortDirection;
  setSortBy: (s: SortBy) => void;
  setSortDirection: (d: SortDirection) => void;
  align?: 'left' | 'center' | 'right';
  priceField?: boolean;
}) {
  const isActive = priceField
    ? sortBy === 'price_high' || sortBy === 'price_low'
    : field === 'newest'
      ? sortBy === 'newest' || sortBy === 'oldest'
      : sortBy === field;

  return (
    <th
      style={{ ...thStyle, textAlign: align }}
      onClick={() => {
        if (priceField) {
          if (sortBy === 'price_high' || sortBy === 'price_low') {
            const next = sortDirection === 'desc' ? 'asc' : 'desc';
            setSortDirection(next);
            setSortBy(next === 'desc' ? 'price_high' : 'price_low');
          } else {
            setSortBy('price_high');
            setSortDirection('desc');
          }
        } else if (isActive) {
          setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
        } else {
          setSortBy(field);
          setSortDirection('desc');
        }
      }}
    >
      {label} {isActive && (sortDirection === 'desc' ? '▼' : '▲')}
    </th>
  );
}

const FeedTableView: React.FC<FeedTableViewProps> = ({
  vehicles, sortBy, sortDirection, setSortBy, setSortDirection,
}) => {
  const navigate = useNavigate();
  const sp = { sortBy, sortDirection, setSortBy, setSortDirection };

  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--border)',
      overflowX: 'auto',
      overflowY: 'visible',
      position: 'relative',
    }}>
      <table style={{ width: '100%', fontSize: '8pt', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--grey-50)' }}>
          <tr style={{ background: 'var(--grey-50)', borderBottom: '2px solid var(--border)' }}>
            <th style={{
              padding: '8px', textAlign: 'left', fontWeight: 'bold', whiteSpace: 'nowrap',
              borderRight: '1px solid var(--border)', position: 'sticky', left: 0,
              background: 'var(--grey-50)', zIndex: 11,
            }}>
              Image
            </th>
            <SortHeader label="Year" field="year" align="center" {...sp} />
            <SortHeader label="Make" field="make" {...sp} />
            <SortHeader label="Model" field="model" {...sp} />
            <SortHeader label="Mileage" field="mileage" align="right" {...sp} />
            <SortHeader label="Price" field="price_high" align="right" priceField {...sp} />
            <SortHeader label="Volume" field="volume" align="right" {...sp} />
            <SortHeader label="Images" field="images" align="right" {...sp} />
            <SortHeader label="Events" field="events" align="right" {...sp} />
            <SortHeader label="Views" field="views" align="right" {...sp} />
            <th style={{ ...thStyle, borderRight: 'none' }}
              onClick={() => {
                if (sortBy === 'newest' || sortBy === 'oldest') {
                  setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                } else {
                  setSortBy('newest');
                  setSortDirection('desc');
                }
              }}
            >
              Updated {(sortBy === 'newest' || sortBy === 'oldest') && (sortDirection === 'desc' ? '▼' : '▲')}
            </th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map(vehicle => (
            <tr
              key={vehicle.id}
              onClick={() => navigate(`/vehicle/${vehicle.id}`)}
              style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.12s ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--grey-50)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <td style={{
                padding: '4px', borderRight: '1px solid var(--border)',
                position: 'sticky', left: 0, background: 'var(--white)', zIndex: 1,
              }}>
                {vehicle.primary_image_url ? (
                  <img
                    src={vehicle.primary_image_url}
                    alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    loading="lazy"
                    style={{ width: 'min(100px, 15vw)', height: 'min(60px, 9vw)', objectFit: 'contain', border: '1px solid var(--border)', display: 'block' }}
                  />
                ) : (
                  <div style={{ width: 'min(100px, 15vw)', height: 'min(60px, 9vw)', background: 'var(--grey-200)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/n-zero.png" alt="Marque" style={{ width: '60%', opacity: 0.3, objectFit: 'contain' }} />
                  </div>
                )}
              </td>
              <td style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{vehicle.year || '—'}</td>
              <td style={{ padding: '8px', fontWeight: 'bold', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{vehicle.make || '—'}</td>
              <td style={{ padding: '8px', borderRight: '1px solid var(--border)' }}>
                {vehicle.model || '—'}
                {vehicle.hype_reason && (
                  <div style={{ fontSize: '7pt', color: 'var(--accent)', fontWeight: 'bold', marginTop: '2px' }}>{vehicle.hype_reason}</div>
                )}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                {vehicle.mileage ? vehicle.mileage.toLocaleString() : '—'}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                {vehicle.display_price ? `$${vehicle.display_price.toLocaleString()}` : '—'}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>—</td>
              <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{vehicle.image_count || 0}</td>
              <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{vehicle.event_count || 0}</td>
              <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{vehicle.view_count || 0}</td>
              <td style={{ padding: '8px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {vehicle.updated_at ? new Date(vehicle.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default FeedTableView;
