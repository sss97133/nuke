import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VehicleRow } from './VehicleRow';
import { VehicleEditModal } from './VehicleEditModal';
import type { MyVehicle } from '../../../hooks/useVehiclesDashboard';

interface MyVehiclesZoneProps {
  vehicles: MyVehicle[];
  defaultExpanded?: boolean;
  onRefresh?: () => void;
}

const formatDate = (dateString: string | null): string => {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const formatRelativeDate = (dateString: string | null): string => {
  if (!dateString) return 'No activity';
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
};

export const MyVehiclesZone: React.FC<MyVehiclesZoneProps> = ({
  vehicles,
  defaultExpanded = true,
  onRefresh
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const navigate = useNavigate();

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
            MY VEHICLES
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate('/vehicles/add');
            }}
            style={{
              padding: '4px 8px',
              fontSize: '7pt',
              fontWeight: 600,
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            + ADD
          </button>
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
              subtitle={`Acq: ${formatDate(vehicle.acquisition_date)} • Last: ${formatRelativeDate(vehicle.last_activity_date)}`}
              eventCount={vehicle.event_count}
              imageCount={vehicle.image_count}
              confidenceScore={vehicle.confidence_score}
              interactionScore={vehicle.interaction_score}
              thumbnailUrl={vehicle.primary_image_url}
              onEdit={() => setEditingVehicleId(vehicle.vehicle_id)}
            />
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingVehicleId && (
        <VehicleEditModal
          vehicleId={editingVehicleId}
          onClose={() => setEditingVehicleId(null)}
          onSaved={() => onRefresh?.()}
        />
      )}
    </div>
  );
};

export default MyVehiclesZone;
