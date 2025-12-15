import React, { forwardRef } from 'react';
import VehicleComments from '../../components/VehicleComments';
import type { VehicleCommentsSectionProps } from './types';

const VehicleCommentsSection = forwardRef<HTMLDivElement, VehicleCommentsSectionProps>(
  ({ vehicleId }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          position: 'sticky',
          top: 'calc(var(--header-height, 48px) + 200px)',
          zIndex: 9, // Lower than work memory so it slides under
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          border: '1px solid var(--color-border)',
          padding: 'var(--space-3)',
          marginTop: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
          transition: 'transform 0.3s ease-out'
        }}
      >
        <VehicleComments vehicleId={vehicleId} />
      </div>
    );
  }
);

VehicleCommentsSection.displayName = 'VehicleCommentsSection';

export default VehicleCommentsSection;