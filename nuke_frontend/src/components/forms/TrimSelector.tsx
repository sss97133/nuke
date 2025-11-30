import React, { useState, useRef, useEffect } from 'react';
import { getTrimOptions, normalizeModelName, type TrimOption } from '../../data/vehicleModelHierarchy';

interface TrimSelectorProps {
  make: string;
  model: string;
  series: string;
  trim: string;
  onTrimChange: (trim: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

const TrimSelector: React.FC<TrimSelectorProps> = ({
  make,
  model,
  series,
  trim,
  onTrimChange,
  disabled = false,
  className = '',
  placeholder = 'e.g., Silverado, Cheyenne, Scottsdale'
}) => {
  const [trimQuery, setTrimQuery] = useState(trim);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [availableTrims, setAvailableTrims] = useState<TrimOption[]>([]);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Normalize model name (remove series prefix if present)
  const normalizedModel = normalizeModelName(model);

  // Update available trims when make/model/series changes
  useEffect(() => {
    if (make && normalizedModel && series) {
      const options = getTrimOptions(make, normalizedModel, series);
      setAvailableTrims(options);
      
      // If current trim is not in available options, keep it (might be custom)
      // But we'll still show suggestions
    } else {
      setAvailableTrims([]);
    }
  }, [make, normalizedModel, series]);

  // Update internal state when prop changes
  useEffect(() => {
    setTrimQuery(trim);
  }, [trim]);

  // Filter suggestions based on query
  const filteredSuggestions = availableTrims.filter(opt =>
    opt.name.toLowerCase().includes(trimQuery.toLowerCase()) ||
    (opt.description && opt.description.toLowerCase().includes(trimQuery.toLowerCase()))
  );

  const handleInputChange = (value: string) => {
    setTrimQuery(value);
    onTrimChange(value);
    if (value.length >= 0 && availableTrims.length > 0) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleSelect = (selectedTrim: TrimOption) => {
    setTrimQuery(selectedTrim.name);
    onTrimChange(selectedTrim.name);
    setShowSuggestions(false);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!suggestionsRef.current?.contains(document.activeElement)) {
        setShowSuggestions(false);
        
        // Try to match input to available trim
        if (trimQuery) {
          const match = availableTrims.find(
            opt => opt.name.toLowerCase() === trimQuery.toLowerCase()
          );
          if (match) {
            setTrimQuery(match.name);
            onTrimChange(match.name);
          }
        }
      }
    }, 150);
  };

  // Show dropdown if we have hierarchy data, otherwise just text input
  const hasHierarchyData = availableTrims.length > 0;

  return (
    <div className={`relative ${className}`}>
      <label htmlFor="trim" className="form-label">Trim</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          id="trim"
          name="trim"
          value={trimQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => hasHierarchyData && setShowSuggestions(true)}
          onBlur={handleBlur}
          disabled={disabled}
          className="form-input"
          placeholder={placeholder}
        />
        
        {/* Trim Suggestions Dropdown */}
        {showSuggestions && hasHierarchyData && filteredSuggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto"
          >
            {filteredSuggestions.map((opt, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSelect(opt)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{opt.name}</span>
                  {opt.years && (
                    <span className="text-xs text-gray-500">
                      {opt.years.start}{opt.years.end ? `-${opt.years.end}` : '+'}
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

export default TrimSelector;

