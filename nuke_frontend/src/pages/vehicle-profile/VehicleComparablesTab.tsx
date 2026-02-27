import React, { useEffect } from 'react';
import { UserComparablesSection } from '../../components/vehicle/UserComparablesSection';
import { SimilarSalesSection } from '../../components/vehicle/SimilarSalesSection';
import type { Vehicle } from './types';

interface VehicleComparablesTabProps {
  vehicle: Vehicle;
  onCountChange?: (count: number) => void;
}

const VehicleComparablesTab: React.FC<VehicleComparablesTabProps> = ({
  vehicle,
  onCountChange
}) => {
  useEffect(() => {
    // Load user-submitted comps count for the tab badge
    const loadCount = async () => {
      try {
        const { supabase } = await import('../../lib/supabase');
        const { count, error } = await supabase
          .from('user_submitted_comparables')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', vehicle.id)
          .eq('status', 'approved');

        if (!error && count !== null && onCountChange) {
          onCountChange(count);
        }
      } catch (error) {
        console.error('Error loading comparables count:', error);
      }
    };

    loadCount();
  }, [vehicle.id, onCountChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Primary: Automated Similar Sales from auction_events + vehicles */}
      <div className="card">
        <SimilarSalesSection
          vehicleId={vehicle.id}
          vehicleYear={vehicle.year}
          vehicleMake={vehicle.make}
          vehicleModel={vehicle.model}
        />
      </div>

      {/* Secondary: Community-submitted comparables */}
      <UserComparablesSection
        vehicleId={vehicle.id}
        vehicleYear={vehicle.year}
        vehicleMake={vehicle.make}
        vehicleModel={vehicle.model}
      />
    </div>
  );
};

export default VehicleComparablesTab;
