/**
 * VehicleTimeline Types
 * 
 * This file centralizes all type definitions for the VehicleTimeline component and its sub-components
 * to ensure consistent typing across the codebase.
 */

// Component props type
export interface VehicleTimelineProps {
  vin?: string;
  vehicleId?: string;
  make?: string;
  model?: string;
  year?: number;
  className?: string;
  onEventClick?: (event: TimelineEvent) => void;
  onTimespanChange?: (timespan: { start: Date; end: Date }) => void;
}

// Database types for timeline events
export interface RawTimelineEvent {
  id: string;
  vehicle_id: string;
  event_type: string;
  source: string;
  event_date: string;
  title: string;
  description?: string;
  confidence_score: number;
  metadata?: Record<string, unknown>;
  source_url?: string;
  image_urls?: string[];
  created_at?: string;
  updated_at?: string;
}

// Timeline event types (frontend-friendly format)
export interface TimelineEvent {
  id: string;
  vehicleId: string;
  eventType: string;
  eventSource: string;
  eventDate: string;
  title: string;
  description?: string;
  confidenceScore: number;
  metadata: Record<string, unknown>;
  sourceUrl?: string;
  imageUrls?: string[];
}

// Filter state types
export interface TimelineFilters {
  selectedEventTypes: string[];
  selectedSources: string[];
  minConfidence: number;
  startDate: string;
  endDate: string;
}

// Event form modal props
export interface EventFormProps {
  isAddingEvent: boolean;
  currentEvent: Partial<TimelineEvent> | null;
  eventTypes: string[];
  vehicleId: string;
  onClose: () => void;
  onSave: (event: TimelineEvent) => void;
}

// Timeline visualization props
export interface TimelineVisualizationProps {
  events: TimelineEvent[];
  loading: boolean;
  error: string | null;
  onEventClick?: (event: TimelineEvent) => void;
  className?: string;
}

// Filter panel props
export interface FilterPanelProps {
  sources: string[];
  eventTypes: string[];
  filters: TimelineFilters;
  onFilterChange: (filters: TimelineFilters) => void;
}

// Timeline actions result type
export interface ActionResult<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: Error;
}

// Type guard for TimelineEvent
export function isTimelineEvent(event: Partial<TimelineEvent> | null): event is TimelineEvent {
  return !!event && 'id' in event && typeof event.id === 'string';
}
