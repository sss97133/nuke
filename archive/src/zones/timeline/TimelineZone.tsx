import React, { useEffect, useState } from 'react';
import { ZoneLayout } from '../shared/ZoneLayout';
import { supabase } from '../../lib/supabaseClient';
import '../styles/timeline-zone.css';

interface TimelineEvent {
  id: string;
  vehicle_id: string;
  event_type: string;
  event_date: string;
  source: string;
  description: string;
  confidence_score: number;
  metadata: Record<string, unknown>;
  created_at: string;
  verified: boolean;
}

interface TimelineZoneProps {
  vehicleId: string;
  className?: string;
}

/**
 * Timeline Zone Component
 * 
 * Displays the chronological history of a vehicle from multiple sources:
 * - Aggregates events from all data sources
 * - Displays confidence scores for each event
 * - Provides filtering and interactive visualization
 * - Supports the multi-source connector framework
 */
export const TimelineZone: React.FC<TimelineZoneProps> = ({
  vehicleId,
  className = ''
}) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  
  // Available event types for filtering
  const eventTypes = [
    'purchase', 'service', 'modification', 'auction', 
    'certification', 'restoration', 'exhibition', 'registration'
  ];

  useEffect(() => {
    async function fetchTimelineEvents() {
      try {
        setLoading(true);
        
        // Real data approach using the Supabase client
        const { data, error } = await supabase
          .from('vehicle_timeline_events')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('event_date', { ascending: false });
          
        if (error) throw error;
        
        setEvents(data || []);
      } catch (err: any) {
        console.error('Error fetching timeline events:', err);
        setError(err.message || 'Failed to load timeline data');
      } finally {
        setLoading(false);
      }
    }
    
    if (vehicleId) {
      fetchTimelineEvents();
    }
  }, [vehicleId]);

  // Filter events by type if a filter is active
  const filteredEvents = activeFilter 
    ? events.filter(event => event.event_type === activeFilter)
    : events;

  // Format date for display
  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  // Get icon for event type
  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'purchase': return '💰';
      case 'service': return '🔧';
      case 'modification': return '🛠️';
      case 'auction': return '🔨';
      case 'certification': return '📜';
      case 'restoration': return '🔄';
      case 'exhibition': return '🏆';
      case 'registration': return '📋';
      default: return '📅';
    }
  };

  return (
    <ZoneLayout 
      title="Vehicle Timeline" 
      className={`timeline-zone ${className}`}
    >
      <div className="timeline-filters">
        <button 
          className={`filter-btn ${activeFilter === null ? 'active' : ''}`}
          onClick={() => setActiveFilter(null)}
        >
          All
        </button>
        {eventTypes.map(type => (
          <button 
            key={type}
            className={`filter-btn ${activeFilter === type ? 'active' : ''}`}
            onClick={() => setActiveFilter(type)}
          >
            {getEventIcon(type)} {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>
      
      {loading ? (
        <div className="timeline-loading">
          <div className="timeline-loading-spinner"></div>
          <p>Loading timeline events...</p>
        </div>
      ) : error ? (
        <div className="timeline-error">
          <p>Error: {error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : filteredEvents.length > 0 ? (
        <div className="timeline-events">
          {filteredEvents.map((event, index) => (
            <div 
              key={event.id} 
              className={`timeline-event ${event.verified ? 'verified' : ''}`}
            >
              <div className="timeline-event-connector">
                <div className="timeline-event-line"></div>
                <div className="timeline-event-dot"></div>
              </div>
              
              <div className="timeline-event-content">
                <div className="timeline-event-header">
                  <div className="event-date-source">
                    <span className="event-date">{formatDate(event.event_date)}</span>
                    <span className="event-source">Source: {event.source}</span>
                  </div>
                  
                  <div className="event-confidence">
                    <div 
                      className="confidence-bar" 
                      style={{ '--confidence': `${event.confidence_score * 100}%` } as React.CSSProperties}
                      title={`Confidence: ${Math.round(event.confidence_score * 100)}%`}
                    ></div>
                  </div>
                </div>
                
                <div className="timeline-event-type">
                  <span className="event-icon">{getEventIcon(event.event_type)}</span>
                  <span className="event-type-label">
                    {event.event_type.charAt(0).toUpperCase() + event.event_type.slice(1)}
                  </span>
                  {event.verified && (
                    <span className="event-verified-badge">Verified</span>
                  )}
                </div>
                
                <div className="timeline-event-description">
                  {event.description}
                </div>
                
                {Object.keys(event.metadata).length > 0 && (
                  <details className="timeline-event-metadata">
                    <summary>Additional Details</summary>
                    <div className="metadata-content">
                      {Object.entries(event.metadata).map(([key, value]) => (
                        <div key={key} className="metadata-item">
                          <span className="metadata-key">{key.replace(/_/g, ' ')}</span>
                          <span className="metadata-value">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="timeline-empty">
          {activeFilter ? (
            <p>No {activeFilter} events found for this vehicle.</p>
          ) : (
            <p>No timeline events found for this vehicle.</p>
          )}
        </div>
      )}
    </ZoneLayout>
  );
};

export default TimelineZone;
