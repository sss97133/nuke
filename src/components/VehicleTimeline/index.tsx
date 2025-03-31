/**
 * VehicleTimeline Component - Public API
 * 
 * This component integrates our vehicle timeline visualization with the main UI
 * while following the established environment variable patterns for production.
 */
import React, { useState } from 'react';
import './VehicleTimeline.css';
import { useTimelineActions } from './useTimelineActions';
import { useVehicleTimelineData } from './useVehicleTimelineData';
import { useFilteredEvents } from './useFilteredEvents';
import { VehicleTimelineProps, TimelineEvent, isTimelineEvent } from './types';
import FilterPanel from './FilterPanel';
import TimelineVisualization from './TimelineVisualization';
import EventForm from './EventForm';

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
  // State for event form
  const [isAddingEvent, setIsAddingEvent] = useState<boolean>(false);
  const [currentEvent, setCurrentEvent] = useState<Partial<TimelineEvent> | null>(null);
  
  // Get vehicle and timeline data
  const {
    loading, 
    error, 
    vehicle, 
    events, 
    sources, 
    eventTypes,
    refreshData,
    updateEvents
  } = useVehicleTimelineData({
    vin,
    vehicleId,
    make,
    model,
    year
  });
  
  // Get timeline actions for managing events
  const {
    addTimelineEvent,
    updateTimelineEvent,
    deleteTimelineEvent,
    exportTimeline,
    enrichTimelineData
  } = useTimelineActions(vehicle?.id);
  
  // Apply filters to events
  const { 
    filters, 
    filteredEvents, 
    updateFilters 
  } = useFilteredEvents(events, onTimespanChange);

  // Handle event click from timeline
  const handleEventClick = (event: TimelineEvent) => {
    // Call parent handler if provided
    if (onEventClick) {
      onEventClick(event);
    }
    
    // Allow editing the event if clicked
    setCurrentEvent(event);
    setIsAddingEvent(true);
  };

  // Handle saving event (add or update)
  const handleSaveEvent = async (eventData: TimelineEvent) => {
    let result;
    
    if (isTimelineEvent(eventData) && events.some(e => e.id === eventData.id)) {
      // Update existing event
      result = await updateTimelineEvent(eventData.id, eventData, { notifyOnComplete: true });
      
      if (result.success) {
        const updatedEvents = events.map(e => e.id === eventData.id ? eventData : e);
        updateEvents(updatedEvents);
      }
    } else {
      // Add new event
      result = await addTimelineEvent(eventData, { notifyOnComplete: true });
      
      if (result.success && result.data) {
        // Add the new event to the events array
        const newEvent = { 
          ...eventData, 
          id: result.data.id || eventData.id 
        };
        
        updateEvents([...events, newEvent]);
      }
    }
    
    // Close the form
    setIsAddingEvent(false);
    setCurrentEvent(null);
  };

  // Handle event deletion
  const handleDeleteEvent = async (eventId: string) => {
    const result = await deleteTimelineEvent(eventId, { notifyOnComplete: true });
    
    if (result.success) {
      // Remove the event from the events array
      const updatedEvents = events.filter(e => e.id !== eventId);
      updateEvents(updatedEvents);
    }
    
    // Close the form
    setIsAddingEvent(false);
    setCurrentEvent(null);
  };

  return (
    <div className={`vehicle-timeline ${className || ''}`}>
      <div className="timeline-header">
        <div className="timeline-info">
          <h2>Vehicle Timeline</h2>
          {vehicle && (
            <div className="vehicle-details">
              {vehicle.year && <span className="vehicle-year">{vehicle.year}</span>}
              {vehicle.make && <span className="vehicle-make">{vehicle.make}</span>}
              {vehicle.model && <span className="vehicle-model">{vehicle.model}</span>}
              {vehicle.vin && <span className="vehicle-vin">VIN: {vehicle.vin}</span>}
            </div>
          )}
        </div>
        
        <div className="timeline-actions">
          <button 
            className="add-event-button" 
            onClick={() => {
              setCurrentEvent({
                vehicleId: vehicle?.id || '',
                eventSource: 'user',
                confidenceScore: 100
              });
              setIsAddingEvent(true);
            }}
          >
            Add Event
          </button>
          
          <button 
            className="export-button"
            onClick={() => exportTimeline(vehicle?.id || '')}
          >
            Export
          </button>
          
          <button 
            className="refresh-button"
            onClick={refreshData}
          >
            Refresh
          </button>
        </div>
      </div>
      
      <div className="timeline-content">
        <div className="timeline-sidebar">
          <FilterPanel
            sources={sources}
            eventTypes={eventTypes}
            filters={filters}
            onFilterChange={updateFilters}
          />
        </div>
        
        <div className="timeline-main">
          <TimelineVisualization
            events={filteredEvents}
            loading={loading}
            error={error}
            onEventClick={handleEventClick}
            className="timeline-view"
          />
        </div>
      </div>
      
      {isAddingEvent && currentEvent && (
        <EventForm
          isAddingEvent={isAddingEvent}
          currentEvent={currentEvent}
          eventTypes={eventTypes}
          vehicleId={vehicle?.id || ''}
          onClose={() => {
            setIsAddingEvent(false);
            setCurrentEvent(null);
          }}
          onSave={handleSaveEvent}
        />
      )}
    </div>
  );
};

export default VehicleTimeline;
