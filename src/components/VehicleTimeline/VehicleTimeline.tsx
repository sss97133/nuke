/**
 * VehicleTimeline Component
 * 
 * This component serves as the main wrapper for the vehicle timeline feature,
 * integrating the data hook, visualization, and Three.js 3D timeline view.
 */
import React, { useState } from 'react';
import { VehicleTimelineProps, TimelineEvent, TimelineFilters } from './types';
import { useVehicleTimelineData } from './useVehicleTimelineData';
import TimelineVisualization from './TimelineVisualization';
import ThreeJsTimeline from './ThreeJsTimeline';
import { useTimelineActions } from './useTimelineActions';
import './VehicleTimeline.css';

const VehicleTimeline: React.FC<VehicleTimelineProps> = ({
  vin,
  vehicleId,
  make,
  model,
  year,
  className,
  onEventClick,
  onTimespanChange
}) => {
  // Data and state management
  const {
    loading,
    error,
    vehicle,
    events,
    sources,
    eventTypes,
    refreshData,
    updateEvents
  } = useVehicleTimelineData({ vin, vehicleId, make, model, year });

  const { addTimelineEvent, updateTimelineEvent, deleteTimelineEvent } = useTimelineActions(vehicleId);
  
  // View mode: 'list' (traditional) or '3d' (Three.js visualization)
  const [viewMode, setViewMode] = useState<'list' | '3d'>('3d');
  
  // Filter states
  const [filters, setFilters] = useState<TimelineFilters>({
    selectedEventTypes: [],
    selectedSources: [],
    minConfidence: 0,
    startDate: '',
    endDate: ''
  });

  // Handle filter changes
  const handleFilterChange = (newFilters: TimelineFilters) => {
    setFilters(newFilters);
  };

  // Apply filters to events
  const filteredEvents = events.filter(event => {
    // Filter by event type
    if (filters.selectedEventTypes.length > 0 && 
        !filters.selectedEventTypes.includes(event.eventType)) {
      return false;
    }

    // Filter by source
    if (filters.selectedSources.length > 0 && 
        !filters.selectedSources.includes(event.eventSource)) {
      return false;
    }

    // Filter by confidence score
    if (event.confidenceScore < filters.minConfidence) {
      return false;
    }

    // Filter by date range
    if (filters.startDate && new Date(event.eventDate) < new Date(filters.startDate)) {
      return false;
    }

    if (filters.endDate && new Date(event.eventDate) > new Date(filters.endDate)) {
      return false;
    }

    return true;
  });

  // Calculate timeline span and notify parent if callback provided
  React.useEffect(() => {
    if (events.length > 0 && onTimespanChange) {
      const dates = events.map(e => new Date(e.eventDate));
      const startDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const endDate = new Date(Math.max(...dates.map(d => d.getTime())));
      
      onTimespanChange({ start: startDate, end: endDate });
    }
  }, [events, onTimespanChange]);

  // Auto-detect the earliest event (likely manufacturing date)
  const getManufactureDate = (): Date | null => {
    if (!events.length) return null;
    
    // Look for manufacture event type first
    const manufactureEvent = events.find(e => 
      e.eventType.toLowerCase() === 'manufacture' || 
      e.eventType.toLowerCase() === 'built'
    );
    
    if (manufactureEvent) {
      return new Date(manufactureEvent.eventDate);
    }
    
    // If no specific manufacture event, use the earliest date and vehicle year
    if (vehicle?.year) {
      return new Date(`${vehicle.year}-01-01`);
    }
    
    // Last resort: earliest event date
    const dates = events.map(e => new Date(e.eventDate));
    return new Date(Math.min(...dates.map(d => d.getTime())));
  };

  // Handle adding a new event
  const handleAddEvent = async (newEvent: Partial<TimelineEvent>) => {
    if (!vehicle?.id) return;

    // Ensure all required fields are set
    const eventToAdd: TimelineEvent = {
      id: newEvent.id || `temp-${Date.now()}`,
      vehicleId: vehicle.id,
      eventType: newEvent.eventType || 'other',
      eventSource: newEvent.eventSource || 'user',
      eventDate: newEvent.eventDate || new Date().toISOString(),
      title: newEvent.title || 'New Event',
      description: newEvent.description || '',
      confidenceScore: newEvent.confidenceScore || 100,
      metadata: newEvent.metadata || {},
      sourceUrl: newEvent.sourceUrl,
      imageUrls: newEvent.imageUrls
    };

    const result = await addTimelineEvent(eventToAdd);

    if (!result.error && result.data) {
      // Convert from DB format to our TimelineEvent format
      const newEvent: TimelineEvent = {
        id: result.data.id as string,
        vehicleId: result.data.vehicle_id as string,
        eventType: result.data.event_type as string,
        eventSource: result.data.source as string,
        eventDate: result.data.event_date as string,
        title: result.data.title as string,
        description: result.data.description as string || '',
        confidenceScore: result.data.confidence_score as number,
        metadata: result.data.metadata as Record<string, unknown> || {},
        sourceUrl: result.data.source_url as string || undefined,
        imageUrls: result.data.image_urls as string[] || undefined
      };
      updateEvents([...events, newEvent]);
    }
  };

  return (
    <div className={`vehicle-timeline ${className || ''}`}>
      {/* Timeline header with controls */}
      <div className="timeline-header">
        <h2 className="timeline-title">
          {vehicle ? (
            <>
              {vehicle.year} {vehicle.make} {vehicle.model} Timeline
              {vehicle.vin && <span className="vin-display">VIN: {vehicle.vin}</span>}
            </>
          ) : (
            'Vehicle Timeline'
          )}
        </h2>
        
        <div className="view-controls">
          <button 
            className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            List View
          </button>
          <button 
            className={`view-mode-btn ${viewMode === '3d' ? 'active' : ''}`}
            onClick={() => setViewMode('3d')}
          >
            3D Timeline
          </button>
        </div>
      </div>
      
      {/* Main timeline content */}
      <div className="timeline-content">
        {viewMode === 'list' ? (
          <TimelineVisualization
            events={filteredEvents}
            loading={loading}
            error={error}
            onEventClick={onEventClick}
            className="list-visualization"
          />
        ) : (
          <ThreeJsTimeline
            events={filteredEvents}
            loading={loading}
            error={error}
            onEventClick={onEventClick}
            manufactureDate={getManufactureDate()}
            className="three-visualization"
          />
        )}
      </div>
    </div>
  );
};

export default VehicleTimeline;
