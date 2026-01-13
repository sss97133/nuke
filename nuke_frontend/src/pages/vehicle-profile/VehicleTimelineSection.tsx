import React from 'react';
import VehicleTimeline from '../../components/VehicleTimeline';
import { VehicleLedgerDocumentsCard } from '../../components/vehicle/VehicleLedgerDocumentsCard';
import type { VehicleTimelineSectionProps } from './types';

const VehicleTimelineSection: React.FC<VehicleTimelineSectionProps> = ({
  vehicle,
  permissions
}) => {
  const { isVerifiedOwner, hasContributorAccess } = permissions;
  const canManageLedger = isVerifiedOwner || hasContributorAccess;

  return (
    <section className="section" id="vehicle-timeline-section">
      <VehicleTimeline
        vehicleId={vehicle.id}
        isOwner={isVerifiedOwner || hasContributorAccess}
      />
      {canManageLedger && (
        <VehicleLedgerDocumentsCard vehicleId={vehicle.id} canManage={canManageLedger} />
      )}
    </section>
  );
};

export default VehicleTimelineSection;