import React from 'react';
import WorkMemoryCapture from '../../components/memory/WorkMemoryCapture';
import type { VehiclePermissions } from './types';

interface WorkMemorySectionProps {
  vehicleId: string;
  permissions: VehiclePermissions;
}

const WorkMemorySection: React.FC<WorkMemorySectionProps> = ({
  vehicleId,
  permissions
}) => {
  const { isVerifiedOwner, hasContributorAccess } = permissions;

  if (!isVerifiedOwner && !hasContributorAccess) {
    return null;
  }

  return (
    <WorkMemoryCapture vehicleId={vehicleId} />
  );
};

export default WorkMemorySection;