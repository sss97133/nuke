/**
 * Organization Service Tab
 * 
 * Shows service vehicles with receipt-driven information
 * Only displayed for service-focused organizations
 */

import React, { useState, useEffect } from 'react';
import { ServiceVehicleCard } from './ServiceVehicleCard';
import { OrganizationIntelligenceService } from '../../services/organizationIntelligenceService';
import { supabase } from '../../lib/supabase';

interface OrganizationServiceTabProps {
  organizationId: string;
}

export const OrganizationServiceTab: React.FC<OrganizationServiceTabProps> = ({
  organizationId
}) => {
  const [serviceVehicles, setServiceVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadServiceVehicles() {
      try {
        setLoading(true);
        const vehicles = await OrganizationIntelligenceService.getServiceVehicles(organizationId);
        setServiceVehicles(vehicles);
      } catch (err) {
        console.error('Error loading service vehicles:', err);
        setError('Failed to load service vehicles');
      } finally {
        setLoading(false);
      }
    }

    loadServiceVehicles();
  }, [organizationId]);

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--grey-600)' }}>
        Loading service vehicles...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--error)' }}>
        {error}
      </div>
    );
  }

  if (serviceVehicles.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '12pt', color: 'var(--grey-600)', marginBottom: '8px' }}>
          No service vehicles found
        </div>
        <div style={{ fontSize: '9pt', color: 'var(--grey-500)' }}>
          Vehicles with service relationship will appear here
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '11pt', fontWeight: 600, color: 'var(--grey-700)' }}>
          Vehicles in Service ({serviceVehicles.length})
        </div>
        <div style={{ fontSize: '9pt', color: 'var(--grey-600)', marginTop: '4px' }}>
          Showing vehicles with active service work
        </div>
      </div>

      <div>
        {serviceVehicles.map((vehicle) => (
          <ServiceVehicleCard
            key={vehicle.vehicle_id}
            vehicleId={vehicle.vehicle_id}
            vehicleInfo={vehicle.vehicle_info}
            receipts={vehicle.receipts || []}
            totalInvestment={vehicle.total_investment || 0}
            totalDays={vehicle.total_days || 0}
            totalLaborHours={vehicle.total_labor_hours || 0}
            jobCount={vehicle.job_count || 0}
            currentStatus={vehicle.current_status || 'pending'}
            primaryImageUrl={vehicle.primary_image_url}
          />
        ))}
      </div>
    </div>
  );
};

