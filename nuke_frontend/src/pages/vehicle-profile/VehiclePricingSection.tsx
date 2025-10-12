import React from 'react';
import { VehiclePricingWidget } from '../../components/VehiclePricingWidget';
import type { Vehicle, VehiclePermissions } from './types';

interface VehiclePricingSectionProps {
  vehicle: Vehicle;
  permissions: VehiclePermissions;
}

const VehiclePricingSection: React.FC<VehiclePricingSectionProps> = ({
  vehicle,
  permissions
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
      />
    </section>
  );
};

export default VehiclePricingSection;