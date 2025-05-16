/**
 * VehicleTimeline Component Exports
 * 
 * This file centralizes exports for the VehicleTimeline component and its subcomponents
 * to simplify imports throughout the application.
 */

import VehicleTimeline from './VehicleTimeline';
import TimelineVisualization from './TimelineVisualization';
import ThreeJsTimeline from './ThreeJsTimeline';
import { useVehicleTimelineData } from './useVehicleTimelineData';
import { useTimelineActions } from './useTimelineActions';

// Support both default and named imports
export default VehicleTimeline;

// Named exports
export { VehicleTimeline };
export { TimelineVisualization };
export { ThreeJsTimeline };
export { useVehicleTimelineData };
export { useTimelineActions };
export * from './types';
