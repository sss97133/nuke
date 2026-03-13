import React, { forwardRef } from 'react';
import VehicleComments from '../../components/VehicleComments';
import type { VehicleCommentsSectionProps } from './types';

/** Renders comments flat inside CollapsibleWidget — no extra wrapper div. */
const VehicleCommentsSection = forwardRef<HTMLDivElement, VehicleCommentsSectionProps>(
  ({ vehicleId }) => {
    return <VehicleComments vehicleId={vehicleId} />;
  }
);

VehicleCommentsSection.displayName = 'VehicleCommentsSection';

export default VehicleCommentsSection;