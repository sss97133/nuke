import React from 'react';
import VehicleTimeline from '../../components/VehicleTimeline';
import type { VehicleTimelineSectionProps } from './types';

const VehicleTimelineSection: React.FC<VehicleTimelineSectionProps> = ({
  vehicle,
  permissions
}) => {
  const { isVerifiedOwner, hasContributorAccess } = permissions;

  return (
    <section className="section" id="vehicle-timeline-section">
      <VehicleTimeline
        vehicleId={vehicle.id}
        isOwner={isVerifiedOwner || hasContributorAccess}
      />
    </section>
  );
};

export default VehicleTimelineSection;