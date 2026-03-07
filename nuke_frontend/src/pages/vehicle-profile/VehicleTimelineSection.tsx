import React from 'react';
import type { VehicleTimelineSectionProps } from './types';
import VehicleTimeline from '../../components/VehicleTimeline';

const VehicleTimelineSection: React.FC<VehicleTimelineSectionProps> = ({
  vehicle,
  session,
  permissions,
}) => {
  const isOwner = !!(session?.user?.id && vehicle?.user_id === session.user.id);

  return (
    <VehicleTimeline
      vehicleId={vehicle.id}
      isOwner={isOwner}
    />
  );
};

export default VehicleTimelineSection;
