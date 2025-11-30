import React, { useState, useRef, useEffect } from 'react';
import { getSeriesOptions, type SeriesOption, normalizeModelName } from '../../data/vehicleModelHierarchy';

interface SeriesSelectorProps {
  make: string;
  model: string;
  series: string;
  onSeriesChange: (series: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

const SeriesSelector: React.FC<SeriesSelectorProps> = ({
  make,
  model,
  series,
  onSeriesChange,
  disabled = false,
  className = '',
  placeholder = 'e.g., K5, C10, K10, K1500'
}) => {
  const [seriesQuery, setSeriesQuery] = useState(series);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [availableSeries, setAvailableSeries] = useState<SeriesOption[]>([]);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Normalize model name (remove series prefix if present)
  const normalizedModel = normalizeModelName(model);

  // Update available series when make/model changes
  useEffect(() => {
    if (make && normalizedModel) {
      const options = getSeriesOptions(make, normalizedModel);
      setAvailableSeries(options);
      
      // If current series is not in available options, clear it
      if (series && !options.some(opt => opt.code === series || opt.name === series)) {
        setSeriesQuery('');
        onSeriesChange('');
      }
    } else {
      setAvailableSeries([]);
    }
  }, [make, normalizedModel, series, onSeriesChange]);

  // Update internal state when prop changes
  useEffect(() => {
    setSeriesQuery(series);
  }, [series]);

  // Filter suggestions based on query
  const filteredSuggestions = availableSeries.filter(opt =>
    opt.code.toLowerCase().includes(seriesQuery.toLowerCase()) ||
    opt.name.toLowerCase().includes(seriesQuery.toLowerCase()) ||
    (opt.description && opt.description.toLowerCase().includes(seriesQuery.toLowerCase()))
  );

  const handleInputChange = (value: string) => {
    setSeriesQuery(value);
    onSeriesChange(value); // Notify parent component of changes
    if (value.length >= 0 && availableSeries.length > 0) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleSelect = (selectedSeries: SeriesOption) => {
    setSeriesQuery(selectedSeries.code);
    onSeriesChange(selectedSeries.code);
    setShowSuggestions(false);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!suggestionsRef.current?.contains(document.activeElement)) {
        setShowSuggestions(false);
        
        // Try to match input to available series
        if (seriesQuery) {
          const match = availableSeries.find(
            opt => opt.code.toLowerCase() === seriesQuery.toLowerCase() ||
                   opt.name.toLowerCase() === seriesQuery.toLowerCase()
          );
          if (match) {
            setSeriesQuery(match.code);
            onSeriesChange(match.code);
          }
        }
      }
    }, 150);
  };

  // Don't show if no hierarchy data available
  if (!make || !normalizedModel || availableSeries.length === 0) {
    return (
      <div className={className}>
        <label htmlFor="series" className="form-label">Series</label>
        <input
          type="text"
          id="series"
          name="series"
          value={seriesQuery}
          onChange={(e) => {
            setSeriesQuery(e.target.value);
            onSeriesChange(e.target.value);
          }}
          disabled={disabled}
          className="form-input"
          placeholder={placeholder}
        />
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <label htmlFor="series" className="form-label">Series</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          id="series"
          name="series"
          value={seriesQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={handleBlur}
          disabled={disabled}
          className="form-input"
          placeholder={placeholder}
        />
        
        {/* Series Suggestions Dropdown */}
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto"
          >
            {filteredSuggestions.map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => handleSelect(opt)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{opt.code}</span>
                  {opt.is2WD && (
                    <span className="text-xs text-gray-500 bg-blue-50 px-2 py-0.5 rounded">
                      2WD
                    </span>
                  )}
                </div>
                {opt.description && (
                  <div className="text-xs text-gray-500 mt-1">{opt.description}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SeriesSelector;

