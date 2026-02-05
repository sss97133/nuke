import React, { useState } from 'react';
import { VehicleRow } from './VehicleRow';
import type { ClientVehicle } from '../../../hooks/useVehiclesDashboard';

interface ClientWorkZoneProps {
  vehicles: ClientVehicle[];
  defaultExpanded?: boolean;
}

const getProximityColor = (daysSinceService: number | null): string => {
  if (daysSinceService === null) return '#f3f4f6'; // grey - no service date
  if (daysSinceService <= 7) return '#dcfce7'; // green - fresh
  if (daysSinceService <= 30) return '#fef3c7'; // amber - recent
  if (daysSinceService <= 90) return '#f9fafb'; // light grey - stale
  return '#f3f4f6'; // grey - old
};

const formatRelativeServiceDate = (dateString: string | null, daysSince: number | null): string => {
  if (!dateString || daysSince === null) return 'Never serviced';

  if (daysSince === 0) return 'Today';
  if (daysSince === 1) return 'Yesterday';
  if (daysSince < 7) return `${daysSince}d ago`;
  if (daysSince < 30) return `${Math.floor(daysSince / 7)}w ago`;
  if (daysSince < 365) return `${Math.floor(daysSince / 30)}mo ago`;
  return `${Math.floor(daysSince / 365)}y ago`;
};

export const ClientWorkZone: React.FC<ClientWorkZoneProps> = ({
  vehicles,
  defaultExpanded = true
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (vehicles.length === 0) {
    return null;
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      marginBottom: 'var(--space-3)'
    }}>
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: expanded ? '1px solid var(--border-light)' : 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontSize: '9pt',
            fontWeight: 700,
            color: 'var(--text)'
          }}>
            CLIENT WORK
          </span>
          <span style={{
            fontSize: '8pt',
            color: 'var(--text-muted)',
            background: 'var(--surface-hover)',
            padding: '2px 6px',
            borderRadius: '2px'
          }}>
            {vehicles.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{
            fontSize: '7pt',
            color: 'var(--text-muted)'
          }}>
            Sorted: Most Recent
          </span>
          <span style={{
            fontSize: '7pt',
            color: 'var(--text-muted)',
            width: '50px',
            textAlign: 'right'
          }}>
            {expanded ? 'COLLAPSE' : 'EXPAND'}
          </span>
        </div>
      </div>

      {/* Vehicle List */}
      {expanded && (
        <div>
          {vehicles.map((vehicle) => (
            <VehicleRow
              key={vehicle.vehicle_id}
              vehicleId={vehicle.vehicle_id}
              year={vehicle.year}
              make={vehicle.make}
              model={vehicle.model}
              subtitle={`Last: ${formatRelativeServiceDate(vehicle.last_service_date, vehicle.days_since_service)} • ${vehicle.service_count} services${vehicle.total_labor_hours > 0 ? ` • ${vehicle.total_labor_hours.toFixed(1)}h` : ''}`}
              confidenceScore={vehicle.confidence_score}
              interactionScore={vehicle.interaction_score}
              backgroundColor={getProximityColor(vehicle.days_since_service)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ClientWorkZone;
