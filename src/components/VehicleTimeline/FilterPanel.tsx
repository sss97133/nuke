/**
 * FilterPanel Component
 * 
 * This component handles all filter controls for the VehicleTimeline,
 * including source, event type, confidence score, and date range filters.
 */
import React from 'react';
import { FilterPanelProps, TimelineFilters } from './types';
import './VehicleTimeline.css';

export const FilterPanel: React.FC<FilterPanelProps> = ({
  sources,
  eventTypes,
  filters,
  onFilterChange
}) => {
  // Source checkbox handler
  const handleSourceChange = (source: string, checked: boolean) => {
    const newSelectedSources = checked
      ? [...filters.selectedSources, source]
      : filters.selectedSources.filter(s => s !== source);
    
    onFilterChange({
      ...filters,
      selectedSources: newSelectedSources
    });
  };

  // Event type checkbox handler
  const handleEventTypeChange = (eventType: string, checked: boolean) => {
    const newSelectedEventTypes = checked
      ? [...filters.selectedEventTypes, eventType]
      : filters.selectedEventTypes.filter(et => et !== eventType);
    
    onFilterChange({
      ...filters,
      selectedEventTypes: newSelectedEventTypes
    });
  };

  // Confidence slider handler
  const handleConfidenceChange = (value: number) => {
    onFilterChange({
      ...filters,
      minConfidence: value
    });
  };

  // Date range handlers
  const handleStartDateChange = (value: string) => {
    onFilterChange({
      ...filters,
      startDate: value
    });
  };

  const handleEndDateChange = (value: string) => {
    onFilterChange({
      ...filters,
      endDate: value
    });
  };

  // Reset filters to default values
  const resetFilters = () => {
    onFilterChange({
      selectedEventTypes: eventTypes,
      selectedSources: sources,
      minConfidence: 0,
      startDate: '',
      endDate: ''
    });
  };

  return (
    <div className="timeline-filters">
      <h3>Filters</h3>
      
      <div className="filter-section">
        <h4>Event Types</h4>
        <div className="filter-checkboxes">
          {eventTypes.map(type => (
            <label key={type} className="filter-checkbox">
              <input
                type="checkbox"
                checked={filters.selectedEventTypes.includes(type)}
                onChange={(e) => handleEventTypeChange(type, e.target.checked)}
              />
              {type}
            </label>
          ))}
        </div>
      </div>
      
      <div className="filter-section">
        <h4>Data Sources</h4>
        <div className="filter-checkboxes">
          {sources.map(source => (
            <label key={source} className="filter-checkbox">
              <input
                type="checkbox"
                checked={filters.selectedSources.includes(source)}
                onChange={(e) => handleSourceChange(source, e.target.checked)}
              />
              {source}
            </label>
          ))}
        </div>
      </div>
      
      <div className="filter-section">
        <h4>Confidence Score: {filters.minConfidence}%</h4>
        <input
          type="range"
          min="0"
          max="100"
          value={filters.minConfidence}
          onChange={(e) => handleConfidenceChange(parseInt(e.target.value))}
          className="confidence-slider"
        />
      </div>
      
      <div className="filter-section">
        <h4>Date Range</h4>
        <div className="date-range-inputs">
          <div className="date-input-group">
            <label htmlFor="start-date">Start Date</label>
            <input
              id="start-date"
              type="date"
              value={filters.startDate}
              onChange={(e) => handleStartDateChange(e.target.value)}
            />
          </div>
          <div className="date-input-group">
            <label htmlFor="end-date">End Date</label>
            <input
              id="end-date"
              type="date"
              value={filters.endDate}
              onChange={(e) => handleEndDateChange(e.target.value)}
            />
          </div>
        </div>
      </div>
      
      <button className="reset-filters-button" onClick={resetFilters}>
        Reset Filters
      </button>
    </div>
  );
};

export default FilterPanel;
