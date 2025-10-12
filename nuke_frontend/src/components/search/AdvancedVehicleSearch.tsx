import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface SearchFilters {
  yearFrom?: number;
  yearTo?: number;
  make?: string;
  model?: string;
  priceFrom?: number;
  priceTo?: number;
  zipCode?: string;
  radius?: number;
  forSale?: boolean;
  textSearch?: string;
}

interface VehicleData {
  years: number[];
  makes: string[];
  models: { [make: string]: string[] };
}

interface AdvancedVehicleSearchProps {
  onSearch: (filters: SearchFilters) => void;
  onReset: () => void;
  loading?: boolean;
}

const AdvancedVehicleSearch: React.FC<AdvancedVehicleSearchProps> = ({
  onSearch,
  onReset,
  loading = false
}) => {
  const [filters, setFilters] = useState<SearchFilters>({});
  const [vehicleData, setVehicleData] = useState<VehicleData>({
    years: [],
    makes: [],
    models: {}
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    loadVehicleData();
  }, []);

  useEffect(() => {
    // Update available models when make changes
    if (filters.make && vehicleData.models[filters.make]) {
      setAvailableModels(vehicleData.models[filters.make]);
    } else {
      setAvailableModels([]);
      // Clear model if make changes
      if (filters.model) {
        setFilters(prev => ({ ...prev, model: undefined }));
      }
    }
  }, [filters.make, vehicleData.models]);

  const loadVehicleData = async () => {
    try {
      // Get all unique years, makes, and models from the database
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('year, make, model')
        .eq('is_public', true)
        .not('make', 'is', null)
        .not('model', 'is', null);

      if (error) {
        console.error('Error loading vehicle data:', error);
        return;
      }

      if (!vehicles) return;

      // Process the data
      const years = [...new Set(vehicles.map(v => v.year))].sort((a, b) => b - a);
      const makes = [...new Set(vehicles.map(v => v.make))].sort();
      
      const models: { [make: string]: string[] } = {};
      vehicles.forEach(vehicle => {
        if (!models[vehicle.make]) {
          models[vehicle.make] = [];
        }
        if (!models[vehicle.make].includes(vehicle.model)) {
          models[vehicle.make].push(vehicle.model);
        }
      });

      // Sort models for each make
      Object.keys(models).forEach(make => {
        models[make].sort();
      });

      setVehicleData({ years, makes, models });
    } catch (error) {
      console.error('Error in loadVehicleData:', error);
    }
  };

  const handleFilterChange = (key: keyof SearchFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value === '' ? undefined : value
    }));
  };

  const handleSearch = () => {
    onSearch(filters);
  };

  const handleReset = () => {
    setFilters({});
    setAvailableModels([]);
    onReset();
  };

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 1900 + 1 }, (_, i) => currentYear - i);

  return (
    <div className="card">
      <div className="card-body">
        <h2 className="text-xs font-semibold text-black mb-4">Find Your Vehicle</h2>
        {/* Quick Search */}
        <div className="mb-4 relative">
          <input
            type="text"
            placeholder="Search anything... (year, make, model, VIN, owner)"
            value={filters.textSearch || ''}
            onChange={(e) => handleFilterChange('textSearch', e.target.value)}
            className="form-input w-full text-xs"
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <button
              onClick={handleSearch}
              disabled={loading}
              className="text-xs text-black hover:text-gray-600"
            >
              Search
            </button>
          </div>
        </div>

        {/* Advanced Search Toggle */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="button button-secondary text-xs"
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced Search
          </button>
        </div>

        {/* Advanced Search Fields */}
        {showAdvanced && (
          <div className="space-y-4">
            {/* Year Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-black mb-1">Year From</label>
                <select
                  value={filters.yearFrom || ''}
                  onChange={(e) => handleFilterChange('yearFrom', e.target.value ? parseInt(e.target.value) : undefined)}
                  className="form-select w-full"
                >
                  <option value="">Any Year</option>
                  {yearOptions.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-black mb-1">Year To</label>
                <select
                  value={filters.yearTo || ''}
                  onChange={(e) => handleFilterChange('yearTo', e.target.value ? parseInt(e.target.value) : undefined)}
                  className="form-select w-full"
                >
                  <option value="">Any Year</option>
                  {yearOptions.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Make and Model */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-black mb-1">Make</label>
                <select
                  value={filters.make || ''}
                  onChange={(e) => handleFilterChange('make', e.target.value)}
                  className="form-select w-full"
                >
                  <option value="" className="text-xs">Any Make</option>
                  {vehicleData.makes.map(make => (
                    <option key={make} value={make}>{make}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-black mb-1">Model</label>
                <select
                  value={filters.model || ''}
                  onChange={(e) => handleFilterChange('model', e.target.value)}
                  className="form-select w-full"
                  disabled={!filters.make}
                >
                  <option value="" className="text-xs">Any Model</option>
                  {availableModels.map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Price Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Price From</label>
                <input
                  type="number"
                  placeholder="Min price"
                  value={filters.priceFrom || ''}
                  onChange={(e) => handleFilterChange('priceFrom', e.target.value ? parseInt(e.target.value) : undefined)}
                  className="form-input w-full"
                />
              </div>
              <div>
                <label className="form-label">Price To</label>
                <input
                  type="number"
                  placeholder="Max price"
                  value={filters.priceTo || ''}
                  onChange={(e) => handleFilterChange('priceTo', e.target.value ? parseInt(e.target.value) : undefined)}
                  className="form-input w-full"
                />
              </div>
            </div>

            {/* Location Search */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Zip Code</label>
                <input
                  type="text"
                  placeholder="Enter zip code"
                  value={filters.zipCode || ''}
                  onChange={(e) => handleFilterChange('zipCode', e.target.value)}
                  className="form-input w-full"
                  maxLength={5}
                />
              </div>
              <div>
                <label className="form-label">Radius (miles)</label>
                <select
                  value={filters.radius || ''}
                  onChange={(e) => handleFilterChange('radius', e.target.value ? parseInt(e.target.value) : undefined)}
                  className="form-select w-full"
                  disabled={!filters.zipCode}
                >
                  <option value="">Any Distance</option>
                  <option value="25">25 miles</option>
                  <option value="50">50 miles</option>
                  <option value="100">100 miles</option>
                  <option value="250">250 miles</option>
                  <option value="500">500 miles</option>
                </select>
              </div>
            </div>

            {/* For Sale Filter */}
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={filters.forSale || false}
                  onChange={(e) => handleFilterChange('forSale', e.target.checked ? true : undefined)}
                  className="form-checkbox mr-2"
                />
                <span className="form-label mb-0">Show only vehicles for sale</span>
              </label>
            </div>
          </div>
        )}

        {/* Search Actions */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={handleSearch}
            disabled={loading}
            className="button button-primary flex-1"
          >
            {loading ? 'Searching...' : 'Search Vehicles'}
          </button>
          <button
            onClick={handleReset}
            className="button button-secondary"
          >
            Reset
          </button>
        </div>

        {/* Active Filters Display */}
        {Object.keys(filters).some(key => filters[key as keyof SearchFilters] !== undefined) && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="text-small text-muted mb-2">Active Filters:</div>
            <div className="flex flex-wrap gap-2">
              {filters.yearFrom && (
                <span className="badge badge-secondary">
                  Year: {filters.yearFrom}+
                </span>
              )}
              {filters.yearTo && (
                <span className="badge badge-secondary">
                  Year: -{filters.yearTo}
                </span>
              )}
              {filters.make && (
                <span className="badge badge-secondary">
                  Make: {filters.make}
                </span>
              )}
              {filters.model && (
                <span className="badge badge-secondary">
                  Model: {filters.model}
                </span>
              )}
              {filters.priceFrom && (
                <span className="badge badge-secondary">
                  Price: ${filters.priceFrom.toLocaleString()}+
                </span>
              )}
              {filters.priceTo && (
                <span className="badge badge-secondary">
                  Price: -${filters.priceTo.toLocaleString()}
                </span>
              )}
              {filters.zipCode && (
                <span className="badge badge-secondary">
                  Near: {filters.zipCode}
                  {filters.radius && ` (${filters.radius}mi)`}
                </span>
              )}
              {filters.forSale && (
                <span className="badge badge-secondary">
                  For Sale
                </span>
              )}
              {filters.textSearch && (
                <span className="badge badge-secondary">
                  Search: "{filters.textSearch}"
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdvancedVehicleSearch;
