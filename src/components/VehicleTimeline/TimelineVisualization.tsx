/**
 * TimelineVisualization Component
 * 
 * This component handles the visual representation of vehicle timeline events
 * in a chronological, interactive format.
 */
import React from 'react';
import { TimelineVisualizationProps, TimelineEvent } from './types';
import './VehicleTimeline.css';

export const TimelineVisualization: React.FC<TimelineVisualizationProps> = ({
  events,
  loading,
  error,
  onEventClick,
  className
}) => {
  if (loading) {
    return (
      <div className={`timeline-visualization ${className || ''}`}>
        <div className="timeline-loading">Loading timeline data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`timeline-visualization ${className || ''}`}>
        <div className="timeline-error">
          <p>Error loading timeline: {error}</p>
          <button className="retry-button">Retry</button>
        </div>
      </div>
    );
  }

  if (!events.length) {
    return (
      <div className={`timeline-visualization ${className || ''}`}>
        <div className="timeline-empty">
          <p>No timeline events found for this vehicle.</p>
        </div>
      </div>
    );
  }

  // Group events by year for better visual organization
  const groupedEvents: { [year: string]: TimelineEvent[] } = events.reduce((groups, event) => {
    const year = new Date(event.eventDate).getFullYear().toString();
    return {
      ...groups,
      [year]: [...(groups[year] || []), event]
    };
  }, {} as { [year: string]: TimelineEvent[] });

  // Sort years chronologically
  const sortedYears = Object.keys(groupedEvents).sort();

  // Get event type class for styling
  const getEventTypeClass = (eventType: string): string => {
    const safeType = eventType.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `event-type-${safeType}`;
  };

  // Get confidence level class
  const getConfidenceClass = (score: number): string => {
    if (score >= 90) return 'confidence-high';
    if (score >= 70) return 'confidence-medium';
    return 'confidence-low';
  };

  // Format date for display
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className={`timeline-visualization ${className || ''}`}>
      <div className="timeline-track">
        {sortedYears.map(year => (
          <div key={year} className="timeline-year-group">
            <div className="timeline-year">{year}</div>
            <div className="timeline-events">
              {groupedEvents[year].map(event => (
                <div 
                  key={event.id}
                  className={`timeline-event ${getEventTypeClass(event.eventType)} ${getConfidenceClass(event.confidenceScore)}`}
                  onClick={() => onEventClick?.(event)}
                >
                  <div className="event-date">{formatDate(event.eventDate)}</div>
                  <div className="event-title">{event.title}</div>
                  {event.description && (
                    <div className="event-description">{event.description}</div>
                  )}
                  <div className="event-metadata">
                    <span className="event-source">{event.eventSource}</span>
                    <span className="event-confidence">{event.confidenceScore}% confidence</span>
                  </div>
                  {event.imageUrls && event.imageUrls.length > 0 && (
                    <div className="event-images">
                      <img 
                        src={event.imageUrls[0]} 
                        alt={event.title} 
                        className="event-image"
                      />
                      {event.imageUrls.length > 1 && (
                        <div className="image-counter">+{event.imageUrls.length - 1}</div>
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
  );
};

export default TimelineVisualization;
