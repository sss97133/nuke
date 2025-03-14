/**
 * VehicleTimeline Component - Public API
 * 
 * This component integrates our vehicle timeline visualization with the main UI
 * while following the established environment variable patterns for production.
 */
import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Import the timeline component, actions and styles
import './VehicleTimeline.css';
import { useTimelineActions } from './useTimelineActions';

// Environment variable handling per established pattern
const getEnvVar = (name: string): string | undefined => {
  return import.meta.env?.[name] || 
         process.env?.[name] || 
         window?.__env?.[name];
};

// Create Supabase client using the fallback mechanism
const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') as string;
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY') as string;
const supabaseServiceKey = getEnvVar('VITE_SUPABASE_SERVICE_KEY') as string;

// Initialize Supabase client
const supabase = createClient(
  supabaseUrl,
  // Use service key for admin operations, fallback to anon key
  supabaseServiceKey || supabaseAnonKey
);

// Component types
export interface VehicleTimelineProps {
  vin?: string;
  vehicleId?: string;
  make?: string;
  model?: string;
  year?: number;
  className?: string;
  onEventClick?: (event: any) => void;
  onTimespanChange?: (timespan: { start: Date; end: Date }) => void;
}

// Timeline event types
export interface TimelineEvent {
  id: string;
  vehicleId: string;
  eventType: string;
  eventSource: string;
  eventDate: string;
  title: string;
  description?: string;
  confidenceScore: number;
  metadata: Record<string, any>;
  sourceUrl?: string;
  imageUrls?: string[];
}

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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<any | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<TimelineEvent[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  
  // Filter states
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  
  // Get timeline actions
  const {
    isAddingEvent,
    setIsAddingEvent,
    currentEvent,
    setCurrentEvent,
    addTimelineEvent,
    updateTimelineEvent,
    deleteTimelineEvent,
    exportTimeline,
    enrichTimelineData
  } = useTimelineActions(vehicleId);
  
  // Type guard for currentEvent to check if it has an ID (existing event)
  const isExistingEvent = (event: Partial<TimelineEvent> | null): event is TimelineEvent => {
    return !!event && 'id' in event && typeof event.id === 'string';
  };

  // Load vehicle data
  useEffect(() => {
    const fetchVehicleData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Query parameters based on provided props
        let query;
        
        if (vin) {
          query = supabase
            .from('vehicles')
            .select('*')
            .eq('vin', vin)
            .single();
        } else if (vehicleId) {
          query = supabase
            .from('vehicles')
            .select('*')
            .eq('id', vehicleId)
            .single();
        } else if (make && model) {
          query = supabase
            .from('vehicles')
            .select('*')
            .eq('make', make)
            .eq('model', model);
            
          if (year) {
            query = query.eq('year', year);
          }
          
          query = query.order('created_at', { ascending: false }).limit(1);
        } else {
          throw new Error('Not enough vehicle information provided');
        }
        
        const { data: vehicleData, error: vehicleError } = await query;
        
        if (vehicleError) throw vehicleError;
        if (!vehicleData) throw new Error('Vehicle not found');
        
        setVehicle(vehicleData);
        
        // Fetch timeline events for the vehicle
        const { data: timelineData, error: timelineError } = await supabase
          .from('vehicle_timeline_events')
          .select('*')
          .eq('vehicle_id', vehicleData.id)
          .order('event_date', { ascending: true });
          
        if (timelineError) throw timelineError;
        
        // Convert to our timeline event format
        const formattedEvents: TimelineEvent[] = (timelineData || []).map((event: any) => ({
          id: event.id,
          vehicleId: event.vehicle_id,
          eventType: event.event_type,
          eventSource: event.source,
          eventDate: event.event_date,
          title: event.title,
          description: event.description,
          confidenceScore: event.confidence_score,
          metadata: event.metadata || {},
          sourceUrl: event.source_url,
          imageUrls: event.image_urls || []
        }));
        
        setEvents(formattedEvents);
        setFilteredEvents(formattedEvents);
        
        // Extract unique sources and event types
        const uniqueSources = [...new Set(formattedEvents.map(e => e.eventSource))];
        const uniqueEventTypes = [...new Set(formattedEvents.map(e => e.eventType))];
        
        setSources(uniqueSources);
        setEventTypes(uniqueEventTypes);
        setSelectedSources(uniqueSources);
        setSelectedEventTypes(uniqueEventTypes);
        
      } catch (err: any) {
        console.error('Error fetching vehicle data:', err);
        setError(err.message || 'Failed to load vehicle data');
      } finally {
        setLoading(false);
      }
    };
    
    if (vin || vehicleId || (make && model)) {
      fetchVehicleData();
    } else {
      setError('Please provide a VIN, vehicle ID, or make and model');
      setLoading(false);
    }
  }, [vin, vehicleId, make, model, year]);
  
  // Apply filters when filter state changes
  useEffect(() => {
    if (!events.length) return;
    
    const filtered = events.filter(event => {
      // Filter by event type
      if (selectedEventTypes.length && !selectedEventTypes.includes(event.eventType)) {
        return false;
      }
      
      // Filter by source
      if (selectedSources.length && !selectedSources.includes(event.eventSource)) {
        return false;
      }
      
      // Filter by confidence
      if (event.confidenceScore < minConfidence) {
        return false;
      }
      
      // Filter by date range
      if (startDate && new Date(event.eventDate) < new Date(startDate)) {
        return false;
      }
      
      if (endDate && new Date(event.eventDate) > new Date(endDate)) {
        return false;
      }
      
      return true;
    });
    
    setFilteredEvents(filtered);
    
    // Notify parent component of timespan if callback provided
    if (onTimespanChange && filtered.length > 0) {
      const dates = filtered.map(e => new Date(e.eventDate));
      const start = new Date(Math.min(...dates.map(d => d.getTime())));
      const end = new Date(Math.max(...dates.map(d => d.getTime())));
      
      onTimespanChange({ start, end });
    }
    
  }, [events, selectedEventTypes, selectedSources, minConfidence, startDate, endDate, onTimespanChange]);
  
  // Event type checkbox handler
  const handleEventTypeChange = (eventType: string, checked: boolean) => {
    if (checked) {
      setSelectedEventTypes(prev => [...prev, eventType]);
    } else {
      setSelectedEventTypes(prev => prev.filter(et => et !== eventType));
    }
  };
  
  // Source checkbox handler
  const handleSourceChange = (source: string, checked: boolean) => {
    if (checked) {
      setSelectedSources(prev => [...prev, source]);
    } else {
      setSelectedSources(prev => prev.filter(s => s !== source));
    }
  };
  
  // Render component
  // Event form modal
  const renderEventForm = () => {
    if (!isAddingEvent || !currentEvent) return null;
    
    return (
      <div className="timeline-modal-overlay">
        <div className="timeline-modal">
          <h3>{isExistingEvent(currentEvent) ? 'Edit Event' : 'Add New Event'}</h3>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (isExistingEvent(currentEvent)) {
              // Update existing event
              updateTimelineEvent(currentEvent.id, currentEvent, {
                notifyOnComplete: true
              }).then(result => {
                if (result.success) {
                  // Update local state
                  setEvents(prev => prev.map(e => 
                    e.id === currentEvent.id ? {...e, ...currentEvent} : e
                  ));
                  setIsAddingEvent(false);
                  setCurrentEvent(null);
                }
              });
            } else {
              // Add new event
              addTimelineEvent(currentEvent as any, {
                notifyOnComplete: true
              }).then(result => {
                if (result.success && result.data) {
                  // Add to local state
                  const newEvent = {
                    id: result.data.id,
                    vehicleId: currentEvent.vehicleId || '',
                    eventType: currentEvent.eventType || '',
                    eventSource: currentEvent.eventSource || 'user',
                    eventDate: currentEvent.eventDate || new Date().toISOString(),
                    title: currentEvent.title || '',
                    description: currentEvent.description,
                    confidenceScore: currentEvent.confidenceScore || 100,
                    metadata: currentEvent.metadata || {},
                    sourceUrl: currentEvent.sourceUrl,
                    imageUrls: currentEvent.imageUrls || []
                  };
                  
                  setEvents(prev => [...prev, newEvent]);
                  setIsAddingEvent(false);
                  setCurrentEvent(null);
                }
              });
            }
          }}>
            <div className="form-group">
              <label htmlFor="event-title">Title</label>
              <input 
                id="event-title"
                type="text"
                value={currentEvent.title || ''}
                onChange={(e) => setCurrentEvent({...currentEvent, title: e.target.value})}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="event-type">Event Type</label>
              <select
                id="event-type"
                value={currentEvent.eventType || ''}
                onChange={(e) => setCurrentEvent({...currentEvent, eventType: e.target.value})}
                required
              >
                <option value="">Select event type</option>
                {eventTypes.length > 0 ? (
                  eventTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))
                ) : (
                  <>
                    <option value="purchase">Purchase</option>
                    <option value="sale">Sale</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="modification">Modification</option>
                    <option value="accident">Accident</option>
                    <option value="auction">Auction</option>
                    <option value="registration">Registration</option>
                    <option value="other">Other</option>
                  </>
                )}
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="event-date">Date</label>
              <input 
                id="event-date"
                type="date"
                value={currentEvent.eventDate?.toString().split('T')[0] || ''}
                onChange={(e) => setCurrentEvent({...currentEvent, eventDate: e.target.value})}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="event-description">Description</label>
              <textarea 
                id="event-description"
                value={currentEvent.description || ''}
                onChange={(e) => setCurrentEvent({...currentEvent, description: e.target.value})}
                rows={3}
              />
            </div>
            
            <div className="form-actions">
              <button 
                type="button" 
                className="cancel-button"
                onClick={() => {
                  setIsAddingEvent(false);
                  setCurrentEvent(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="save-button">
                {isExistingEvent(currentEvent) ? 'Update' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };
  
  return (
    <div className={`vehicle-timeline-container ${className || ''}`}>
      {renderEventForm()}
      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading vehicle timeline...</p>
        </div>
      ) : error ? (
        <div className="error-container">
          <h3>Error loading timeline</h3>
          <p>{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="retry-button"
          >
            Try Again
          </button>
        </div>
      ) : !vehicle ? (
        <div className="error-container">
          <h3>Vehicle Not Found</h3>
          <p>Could not find vehicle with the provided information.</p>
        </div>
      ) : (
        <>
          {/* Vehicle info section */}
          <div className="vehicle-info-header">
            <h2>{vehicle.year} {vehicle.make} {vehicle.model}</h2>
            {vehicle.vin && <p className="vin">VIN: {vehicle.vin}</p>}
            <div className="timeline-actions">
              <button 
                className="timeline-action-button"
                onClick={() => enrichTimelineData(vehicle.vin, vehicle.id)}
                title="Fetch additional data from external sources"
              >
                Enrich Data
              </button>
              <button 
                className="timeline-action-button"
                onClick={() => exportTimeline(filteredEvents)}
                disabled={filteredEvents.length === 0}
                title="Export timeline to CSV"
              >
                Export
              </button>
              <button 
                className="timeline-action-button"
                onClick={() => {
                  setCurrentEvent({
                    vehicleId: vehicle.id,
                    eventType: '',
                    eventSource: 'user',
                    eventDate: new Date().toISOString().split('T')[0],
                    title: '',
                    confidenceScore: 100,
                    metadata: {}
                  });
                  setIsAddingEvent(true);
                }}
                title="Add new event"
              >
                Add Event
              </button>
            </div>
          </div>
          
          <div className="timeline-content">
            {/* Filter panel */}
            <div className="filter-panel">
              <h3>Filter Timeline</h3>
              
              {/* Event type filters */}
              <div className="filter-group">
                <label>Event Types</label>
                <div className="event-type-checkboxes">
                  {eventTypes.map(eventType => (
                    <div key={eventType} className="checkbox-item">
                      <input
                        type="checkbox"
                        id={`event-type-${eventType}`}
                        checked={selectedEventTypes.includes(eventType)}
                        onChange={(e) => handleEventTypeChange(eventType, e.target.checked)}
                      />
                      <label htmlFor={`event-type-${eventType}`}>{eventType}</label>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Source filters */}
              <div className="filter-group">
                <label>Sources</label>
                <div className="source-checkboxes">
                  {sources.map(source => (
                    <div key={source} className="checkbox-item">
                      <input
                        type="checkbox"
                        id={`source-${source}`}
                        checked={selectedSources.includes(source)}
                        onChange={(e) => handleSourceChange(source, e.target.checked)}
                      />
                      <label htmlFor={`source-${source}`}>{source}</label>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Confidence filter */}
              <div className="filter-group">
                <label>Minimum Confidence: {minConfidence}%</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(parseInt(e.target.value))}
                />
              </div>
              
              {/* Date range filters */}
              <div className="filter-group">
                <label>Date Range</label>
                <div className="date-inputs">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    placeholder="Start date"
                  />
                  <span>to</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    placeholder="End date"
                  />
                </div>
              </div>
            </div>
            
            {/* Timeline events */}
            <div className="timeline-events">
              {filteredEvents.length === 0 ? (
                <div className="empty-timeline">
                  <h3>No events found</h3>
                  <p>Try adjusting your filters to see more results.</p>
                </div>
              ) : (
                <div className="timeline-years">
                  {/* Group events by year and month */}
                  {Object.entries(
                    filteredEvents.reduce((acc, event) => {
                      const date = new Date(event.eventDate);
                      const year = date.getFullYear();
                      const month = date.getMonth();
                      
                      acc[year] = acc[year] || {};
                      acc[year][month] = acc[year][month] || [];
                      acc[year][month].push(event);
                      
                      return acc;
                    }, {} as Record<number, Record<number, TimelineEvent[]>>)
                  ).sort(([yearA], [yearB]) => Number(yearB) - Number(yearA))
                   .map(([year, months]) => (
                    <div key={year} className="timeline-year">
                      <h3 className="year-header">{year}</h3>
                      <div className="timeline-months">
                        {Object.entries(months)
                          .sort(([monthA], [monthB]) => Number(monthB) - Number(monthA))
                          .map(([month, monthEvents]) => (
                            <div key={`${year}-${month}`} className="timeline-month">
                              <h4 className="month-header">
                                {new Date(0, Number(month)).toLocaleString('default', { month: 'long' })}
                              </h4>
                              <div className="month-events">
                                {monthEvents.map(event => (
                                  <div 
                                    key={event.id} 
                                    className="timeline-event-card"
                                    onClick={() => onEventClick && onEventClick(event)}
                                  >
                                    <div className="event-header">
                                      <h4>{event.title}</h4>
                                      <span className={`event-badge ${event.eventType.toLowerCase().replace(/\s+/g, '-')}`}>
                                        {event.eventType}
                                      </span>
                                      <div className="event-actions">
                                        <button 
                                          className="event-action-button edit"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setCurrentEvent(event);
                                            setIsAddingEvent(true);
                                          }}
                                          title="Edit event"
                                        >
                                          ✏️
                                        </button>
                                        <button 
                                          className="event-action-button delete"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm('Are you sure you want to delete this event?')) {
                                              deleteTimelineEvent(event.id, { notifyOnComplete: true });
                                              // Remove from local state
                                              setEvents(prev => prev.filter(e => e.id !== event.id));
                                              setFilteredEvents(prev => prev.filter(e => e.id !== event.id));
                                            }
                                          }}
                                          title="Delete event"
                                        >
                                          🗑️
                                        </button>
                                      </div>
                                    </div>
                                    <div className="event-details">
                                      <span className="event-date">
                                        {new Date(event.eventDate).toLocaleDateString()}
                                      </span>
                                      <span className="event-source">
                                        {event.sourceUrl ? (
                                          <a 
                                            href={event.sourceUrl} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {event.eventSource}
                                          </a>
                                        ) : (
                                          event.eventSource
                                        )}
                                      </span>
                                      <div 
                                        className={`confidence-indicator ${
                                          event.confidenceScore >= 80 ? 'high' : 
                                          event.confidenceScore >= 50 ? 'medium' : 'low'
                                        }`}
                                        title={`Confidence score: ${event.confidenceScore}%`}
                                      >
                                        <div 
                                          className="confidence-bar" 
                                          style={{ width: `${event.confidenceScore}%` }}
                                        ></div>
                                      </div>
                                    </div>
                                    {event.description && (
                                      <p className="event-description">{event.description}</p>
                                    )}
                                    {Object.keys(event.metadata).length > 0 && (
                                      <div className="event-metadata">
                                        {Object.entries(event.metadata).map(([key, value]) => (
                                          <span key={key} className="metadata-item">
                                            <span>{key}:</span> {String(value)}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {event.imageUrls && event.imageUrls.length > 0 && (
                                      <div className="event-images">
                                        {event.imageUrls.slice(0, 3).map((url, index) => (
                                          <img 
                                            key={index} 
                                            src={url} 
                                            alt={`${event.eventType} image ${index + 1}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              window.open(url, '_blank');
                                            }}
                                          />
                                        ))}
                                        {event.imageUrls.length > 3 && (
                                          <div 
                                            className="more-images"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (event.imageUrls && event.imageUrls.length > 3) {
                                                alert(`All images: ${event.imageUrls.join('\n')}`);
                                              }
                                            }}
                                          >
                                            +{event.imageUrls.length - 3} more
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default VehicleTimeline;
