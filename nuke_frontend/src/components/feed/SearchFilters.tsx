import { useState, useEffect } from 'react';
import type { SearchFilters } from './types';
import '../../design-system.css';

interface SearchFiltersProps {
  searchQuery: string;
  filters: SearchFilters;
  onSearchChange: (query: string) => void;
  onFiltersChange: (filters: SearchFilters) => void;
}

const SearchFiltersComponent = ({ searchQuery, filters, onSearchChange, onFiltersChange }: SearchFiltersProps) => {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');

  const contentTypeOptions = [
    { value: 'all', label: 'All Content' },
    { value: 'timeline_event', label: 'Events & Actions' },
    { value: 'vehicle', label: 'Vehicles' },
    { value: 'image', label: 'Images' },
    { value: 'shop', label: 'Shops' },
    { value: 'auction', label: 'Auctions' },
    { value: 'user_activity', label: 'User Activity' }
  ];

  const dateRangeOptions = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'all', label: 'All Time' }
  ];

  const sortByOptions = [
    { value: 'recent', label: 'Most Recent' },
    { value: 'popular', label: 'Most Popular' },
    { value: 'nearby', label: 'Nearby' }
  ];

  const handleContentTypeToggle = (type: string) => {
    if (type === 'all') {
      onFiltersChange({
        ...filters,
        contentTypes: ['all']
      });
    } else {
      const newTypes = filters.contentTypes.includes('all')
        ? [type]
        : filters.contentTypes.includes(type)
          ? filters.contentTypes.filter(t => t !== type)
          : [...filters.contentTypes, type];

      onFiltersChange({
        ...filters,
        contentTypes: newTypes.length === 0 ? ['all'] : newTypes
      });
    }
  };

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          onFiltersChange({
            ...filters,
            location: {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            }
          });
          setLocationQuery('Current Location');
        },
        (error) => {
          console.error('Error getting location:', error);
        }
      );
    }
  };

  return (
    <div className="search-filters">
      {/* Main Search Bar */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            className="input"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{
              paddingRight: '80px',
              fontSize: '8pt',
              borderRadius: '2px'
            }}
          />
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="button button-secondary"
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '2px 4px',
              fontSize: '8pt',
              borderRadius: '2px'
            }}
          >
            {showAdvancedFilters ? 'Less' : 'Filters'}
          </button>
        </div>
      </div>

      {/* Quick Content Type Filters */}
      <div className="content-type-filters" style={{ marginBottom: '8px' }}>
        <div style={{
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          {contentTypeOptions.map(option => (
            <button
              key={option.value}
              onClick={() => handleContentTypeToggle(option.value)}
              className={`button ${
                filters.contentTypes.includes(option.value) ||
                (option.value === 'all' && filters.contentTypes.includes('all'))
                  ? 'button-primary'
                  : 'button-secondary'
              }`}
              style={{
                padding: '4px 6px',
                fontSize: '8pt',
                border: filters.contentTypes.includes(option.value) ? '2px solid #3b82f6' : '1px solid #c0c0c0',
                borderRadius: '2px'
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Filters Panel */}
      {showAdvancedFilters && (
        <div className="advanced-filters" style={{
          background: '#f8fafc',
          border: '1px solid #c0c0c0',
          borderRadius: '2px',
          padding: '8px',
          marginBottom: '8px'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '8px'
          }}>
            {/* Location Filter */}
            <div>
              <label className="text text-bold" style={{ display: 'block', marginBottom: '8px' }}>
                Location
              </label>
              <div style={{ marginBottom: '8px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Enter city, state, or ZIP"
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  style={{ marginBottom: '6px', fontSize: '8pt', borderRadius: '2px' }}
                />
                <button
                  onClick={getCurrentLocation}
                  className="button button-secondary w-full"
                  style={{ fontSize: '8pt', padding: '4px', borderRadius: '2px' }}
                >
                  Use Current Location
                </button>
              </div>

              <div>
                <label className="text" style={{ fontSize: '8pt', marginBottom: '4px', display: 'block' }}>
                  Radius: {filters.radius} miles
                </label>
                <input
                  type="range"
                  min="1"
                  max="500"
                  value={filters.radius}
                  onChange={(e) => onFiltersChange({
                    ...filters,
                    radius: parseInt(e.target.value)
                  })}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8pt', color: '#6b7280' }}>
                  <span>1mi</span>
                  <span>500mi</span>
                </div>
              </div>
            </div>

            {/* Date Range Filter */}
            <div>
              <label className="text text-bold" style={{ display: 'block', marginBottom: '8px' }}>
                Time Range
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {dateRangeOptions.map(option => (
                  <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="radio"
                      name="dateRange"
                      value={option.value}
                      checked={filters.dateRange === option.value}
                      onChange={(e) => onFiltersChange({
                        ...filters,
                        dateRange: e.target.value as any
                      })}
                    />
                    <span className="text" style={{ fontSize: '8pt' }}>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Sort By Filter */}
            <div>
              <label className="text text-bold" style={{ display: 'block', marginBottom: '8px' }}>
                Sort By
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {sortByOptions.map(option => (
                  <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="radio"
                      name="sortBy"
                      value={option.value}
                      checked={filters.sortBy === option.value}
                      onChange={(e) => onFiltersChange({
                        ...filters,
                        sortBy: e.target.value as any
                      })}
                    />
                    <span className="text" style={{ fontSize: '8pt' }}>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Active Filters Summary */}
          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #c0c0c0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span className="text text-bold" style={{ fontSize: '8pt' }}>Active Filters:</span>

              {filters.contentTypes.length > 0 && !filters.contentTypes.includes('all') && (
                <span className="badge" style={{
                  background: '#f3f4f6',
                  color: '#374151',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  fontSize: '8pt',
                  border: '1px solid #c0c0c0'
                }}>
                  {filters.contentTypes.length} content types
                </span>
              )}

              {filters.location && (
                <span className="badge" style={{
                  background: '#f3f4f6',
                  color: '#374151',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  fontSize: '8pt',
                  border: '1px solid #c0c0c0'
                }}>
                  {filters.radius}mi radius
                </span>
              )}

              {filters.dateRange !== 'all' && (
                <span className="badge" style={{
                  background: '#f3f4f6',
                  color: '#374151',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  fontSize: '8pt',
                  border: '1px solid #c0c0c0'
                }}>
                  {dateRangeOptions.find(o => o.value === filters.dateRange)?.label}
                </span>
              )}

              <button
                onClick={() => onFiltersChange({
                  contentTypes: ['all'],
                  radius: 50,
                  dateRange: 'all',
                  sortBy: 'recent'
                })}
                className="text"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: '8pt',
                  textDecoration: 'underline'
                }}
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchFiltersComponent;