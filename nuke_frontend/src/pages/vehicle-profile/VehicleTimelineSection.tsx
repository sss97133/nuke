import React from 'react';
import VehicleTimeline from '../../components/VehicleTimeline';
import type { VehicleTimelineSectionProps } from './types';

const VehicleTimelineSection: React.FC<VehicleTimelineSectionProps> = ({
  vehicle,
  permissions,
  onAddEventClick
}) => {
  const { isVerifiedOwner, hasContributorAccess } = permissions;

  return (
    <section className="section" id="vehicle-timeline-section">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold">Timeline</h2>
        {(isVerifiedOwner || hasContributorAccess) && (
          <button
            onClick={onAddEventClick}
            className="button button-primary"
          >
            Add Event
          </button>
        )}
      </div>
      <VehicleTimeline
        vehicleId={vehicle.id}
        isOwner={isVerifiedOwner || hasContributorAccess}
      />
    </section>
  );
};

export default VehicleTimelineSection;