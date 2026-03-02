import React from 'react';
import type { VehicleTimelineSectionProps } from './types';

/**
 * VehicleTimelineSection — renders the vehicle event timeline.
 * Stub created to resolve missing-module build errors.
 * TODO: Extract timeline rendering from VehicleProfile into this component.
 */
const VehicleTimelineSection: React.FC<VehicleTimelineSectionProps> = ({
  vehicle,
  session,
  permissions,
  onAddEventClick,
}) => {
  // Placeholder: timeline content is currently rendered inline by WorkspaceContent
  // via the CollapsibleWidget wrapper. This component will be fleshed out
  // once timeline rendering is fully extracted.
  return null;
};

export default VehicleTimelineSection;
