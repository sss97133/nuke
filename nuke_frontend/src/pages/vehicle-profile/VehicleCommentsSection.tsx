import React, { forwardRef } from 'react';
import VehicleComments from '../../components/VehicleComments';
import type { VehicleCommentsSectionProps } from './types';

const VehicleCommentsSection = forwardRef<HTMLDivElement, VehicleCommentsSectionProps>(
  ({ vehicleId }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          border: '1px solid var(--color-border)',
          padding: 'var(--space-3)',
        }}
      >
        <VehicleComments vehicleId={vehicleId} />
      </div>
    );
  }
);

VehicleCommentsSection.displayName = 'VehicleCommentsSection';

export default VehicleCommentsSection;