import React, { useState } from 'react';
import { VehicleRow } from './VehicleRow';
import type { BusinessFleet } from '../../../hooks/useVehiclesDashboard';

interface BusinessFleetZoneProps {
  fleets: BusinessFleet[];
  defaultExpanded?: boolean;
}

export const BusinessFleetZone: React.FC<BusinessFleetZoneProps> = ({
  fleets,
  defaultExpanded = false
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [expandedBusinesses, setExpandedBusinesses] = useState<Set<string>>(new Set());

  const totalVehicles = fleets.reduce((sum, f) => sum + f.vehicle_count, 0);

  if (fleets.length === 0 || totalVehicles === 0) {
    return null;
  }

  const toggleBusiness = (businessId: string) => {
    setExpandedBusinesses(prev => {
      const next = new Set(prev);
      if (next.has(businessId)) {
        next.delete(businessId);
      } else {
        next.add(businessId);
      }
      return next;
    });
  };

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
            BUSINESS FLEET
          </span>
          <span style={{
            fontSize: '8pt',
            color: 'var(--text-muted)',
            background: 'var(--surface-hover)',
            padding: '2px 6px',
            borderRadius: '2px'
          }}>
            {fleets.length} orgs, {totalVehicles} vehicles
          </span>
        </div>
        <span style={{
          fontSize: '7pt',
          color: 'var(--text-muted)',
          width: '50px',
          textAlign: 'right'
        }}>
          {expanded ? 'COLLAPSE' : 'EXPAND'}
        </span>
      </div>

      {/* Fleet Groups */}
      {expanded && (
        <div>
          {fleets.map((fleet) => {
            const isBusinessExpanded = expandedBusinesses.has(fleet.business_id);

            return (
              <div key={fleet.business_id}>
                {/* Business Header */}
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'var(--surface-hover)',
                    borderBottom: '1px solid var(--border-light)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer'
                  }}
                  onClick={() => toggleBusiness(fleet.business_id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '8pt',
                      color: 'var(--text-muted)'
                    }}>
                      {isBusinessExpanded ? '▼' : '▶'}
                    </span>
                    <span style={{
                      fontSize: '9pt',
                      fontWeight: 600,
                      color: 'var(--text)'
                    }}>
                      {fleet.business_name}
                    </span>
                    <span style={{
                      fontSize: '8pt',
                      color: 'var(--text-muted)'
                    }}>
                      ({fleet.vehicle_count})
                    </span>
                  </div>
                </div>

                {/* Business Vehicles */}
                {isBusinessExpanded && fleet.vehicles.map((vehicle) => (
                  <VehicleRow
                    key={vehicle.vehicle_id}
                    vehicleId={vehicle.vehicle_id}
                    year={vehicle.year}
                    make={vehicle.make}
                    model={vehicle.model}
                    subtitle={vehicle.fleet_role || 'Fleet vehicle'}
                    confidenceScore={vehicle.confidence_score}
                    interactionScore={vehicle.interaction_score}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BusinessFleetZone;
