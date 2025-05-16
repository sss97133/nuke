/**
 * useFilteredEvents Hook
 * 
 * This hook handles filtering timeline events based on user-defined criteria.
 */
import { useState, useEffect } from 'react';
import { TimelineEvent, TimelineFilters } from './types';

export function useFilteredEvents(
  events: TimelineEvent[],
  onTimespanChange?: (timespan: { start: Date; end: Date }) => void
) {
  // Initialize filter state
  const [filters, setFilters] = useState<TimelineFilters>({
    selectedEventTypes: [],
    selectedSources: [],
    minConfidence: 0,
    startDate: '',
    endDate: ''
  });
  
  // Store filtered events
  const [filteredEvents, setFilteredEvents] = useState<TimelineEvent[]>(events);

  // Update filter defaults when event data changes
  useEffect(() => {
    if (events.length > 0) {
      const uniqueSources = Array.from(new Set(events.map(e => e.eventSource)));
      const uniqueEventTypes = Array.from(new Set(events.map(e => e.eventType)));
      
      setFilters(prev => ({
        ...prev,
        selectedEventTypes: uniqueEventTypes,
        selectedSources: uniqueSources
      }));
    }
  }, [events]);

  // Apply filters when filter state or events change
  useEffect(() => {
    if (!events.length) {
      setFilteredEvents([]);
      return;
    }
    
    const filtered = events.filter(event => {
      // Filter by event type
      if (filters.selectedEventTypes.length && !filters.selectedEventTypes.includes(event.eventType)) {
        return false;
      }
      
      // Filter by source
      if (filters.selectedSources.length && !filters.selectedSources.includes(event.eventSource)) {
        return false;
      }
      
      // Filter by confidence
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
    
    setFilteredEvents(filtered);
    
    // Notify parent component of timespan if callback provided
    if (onTimespanChange && filtered.length > 0) {
      const dates = filtered.map(e => new Date(e.eventDate));
      const start = new Date(Math.min(...dates.map(d => d.getTime())));
      const end = new Date(Math.max(...dates.map(d => d.getTime())));
      
      onTimespanChange({ start, end });
    }
  }, [events, filters, onTimespanChange]);

  // Function to update filters
  const updateFilters = (newFilters: TimelineFilters) => {
    setFilters(newFilters);
  };

  return {
    filters,
    filteredEvents,
    updateFilters
  };
}
