import React from 'react';
import type { ImageViewerFilters, SortMode } from './useImageViewerState';

interface ImageFiltersProps {
  filters: ImageViewerFilters;
  sortMode: SortMode;
  showFilters: boolean;
  onUpdateFilters: (filters: Partial<ImageViewerFilters>) => void;
  onResetFilters: () => void;
  onSortModeChange: (mode: SortMode) => void;
  onToggleFilters: () => void;
}

export const ImageFilters: React.FC<ImageFiltersProps> = ({
  filters,
  sortMode,
  showFilters,
  onUpdateFilters,
  onResetFilters,
  onSortModeChange,
  onToggleFilters
}) => {
  const hasActiveFilters = filters.stage || filters.role || filters.area || filters.part;

  return (
    <div className="space-y-3">
      {/* Filter toggle and sort controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleFilters}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${
              showFilters || hasActiveFilters
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Filters {hasActiveFilters && `(${Object.values(filters).filter(Boolean).length})`}
          </button>

          {hasActiveFilters && (
            <button
              onClick={onResetFilters}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Sort:</label>
          <select
            value={sortMode}
            onChange={(e) => onSortModeChange(e.target.value as SortMode)}
            className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="primary_newest">Primary First, Then Newest</option>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </div>

      {/* Filter inputs */}
      {showFilters && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Stage
              </label>
              <input
                type="text"
                value={filters.stage}
                onChange={(e) => onUpdateFilters({ stage: e.target.value })}
                placeholder="Process stage..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role
              </label>
              <input
                type="text"
                value={filters.role}
                onChange={(e) => onUpdateFilters({ role: e.target.value })}
                placeholder="Workflow role..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Area
              </label>
              <input
                type="text"
                value={filters.area}
                onChange={(e) => onUpdateFilters({ area: e.target.value })}
                placeholder="Area..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Part
              </label>
              <input
                type="text"
                value={filters.part}
                onChange={(e) => onUpdateFilters({ part: e.target.value })}
                placeholder="Part..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};