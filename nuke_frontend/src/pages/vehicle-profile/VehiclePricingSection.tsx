import React from 'react';
import type { Vehicle, VehiclePermissions } from './types';

interface VehiclePricingSectionProps {
  vehicle: Vehicle;
  permissions: VehiclePermissions;
  initialValuation?: any | null;
}

/**
 * VehiclePricingSection — wrapper around VehiclePricingWidget.
 * Shelved: valuation requires reliable ingestion + analysis pipelines
 * (comparables + images). Will re-enable once those systems are trustworthy.
 */
const VehiclePricingSection: React.FC<VehiclePricingSectionProps> = () => {
  return null;
};

export default VehiclePricingSection;
