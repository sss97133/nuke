import React from 'react';
import { VehiclePricingWidget } from '../../components/VehiclePricingWidget';
import type { Vehicle, VehiclePermissions } from './types';

interface VehiclePricingSectionProps {
  vehicle: Vehicle;
  permissions: VehiclePermissions;
  initialValuation?: any | null; // From RPC to avoid duplicate query
}

const VehiclePricingSection: React.FC<VehiclePricingSectionProps> = ({
  vehicle,
  permissions,
  initialValuation
}) => {
  const { isVerifiedOwner, hasContributorAccess } = permissions;

  return (
    <section className="section" id="price-section">
      <VehiclePricingWidget
        vehicleId={vehicle.id}
        vehicleInfo={{
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mileage: vehicle.mileage || undefined
        }}
        isOwner={isVerifiedOwner || hasContributorAccess}
        initialValuation={initialValuation}
      />
    </section>
  );
};

export default VehiclePricingSection;