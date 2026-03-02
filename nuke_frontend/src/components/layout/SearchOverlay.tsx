import React, { useRef, useEffect, useState } from 'react';
import type { AutocompleteResult } from './hooks/useSearch';
import type { RecentItem } from './hooks/useRecentItems';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  autocompleteResults: AutocompleteResult[];
  autocompleteLoading: boolean;
  recentItems: RecentItem[];
  onSelect: (category: string, value: string, label: string) => void;
  onRecentSelect: (query: string) => void;
  onRecentRemove: (query: string) => void;
  onRecentClear: () => void;
  query: string;
}

export const SearchOverlay: React.FC<SearchOverlayProps> = ({
  isOpen,
  onClose,
  autocompleteResults,
  autocompleteLoading,
  recentItems,
  onSelect,
  onRecentSelect,
  onRecentRemove,
  onRecentClear,
  query,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use setTimeout to avoid immediate close from the triggering click
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [isOpen, onClose]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(-1);
  }, [autocompleteResults, query]);

  if (!isOpen) return null;

  const showRecent = !query.trim() && recentItems.length > 0;
  const showAutocomplete = query.trim().length >= 2 && autocompleteResults.length > 0;
  const showLoading = query.trim().length >= 2 && autocompleteLoading && autocompleteResults.length === 0;
  const showEmpty = query.trim().length >= 2 && !autocompleteLoading && autocompleteResults.length === 0;

  // Group autocomplete by category
  const grouped: Record<string, AutocompleteResult[]> = {};
  for (const r of autocompleteResults) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  }

  const CATEGORY_LABELS: Record<string, string> = {
    make: 'MAKES',
    model: 'MODELS',
    vehicle: 'VEHICLES',
  };

  return (
    <div className="search-overlay" ref={overlayRef}>
      {showRecent && (
        <div className="search-overlay-section">
          <div className="search-overlay-section-header">
            <span className="search-overlay-section-label">RECENT</span>
            <button
              className="search-overlay-clear-btn"
              onClick={onRecentClear}
              type="button"
            >
              CLEAR
            </button>
          </div>
          {recentItems.slice(0, 8).map((item) => (
            <button
              key={item.query}
              className="search-overlay-item"
              onClick={() => onRecentSelect(item.query)}
              type="button"
            >
              <span className="search-overlay-item-icon">&#8635;</span>
              <span className="search-overlay-item-label">{item.query}</span>
              <button
                className="search-overlay-item-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRecentRemove(item.query);
                }}
                type="button"
                tabIndex={-1}
              >
                &times;
              </button>
            </button>
          ))}
        </div>
      )}

      {showLoading && (
        <div className="search-overlay-loading">
          <span className="search-overlay-loading-text">SEARCHING...</span>
        </div>
      )}

      {showAutocomplete && Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="search-overlay-section">
          <div className="search-overlay-section-header">
            <span className="search-overlay-section-label">
              {CATEGORY_LABELS[category] || category.toUpperCase()}
            </span>
          </div>
          {items.map((item) => (
            <button
              key={`${category}-${item.value}`}
              className="search-overlay-item"
              onClick={() => onSelect(category, item.value, item.label)}
              type="button"
            >
              <span className="search-overlay-item-label">{item.label}</span>
              {item.count > 0 && (
                <span className="search-overlay-item-count">
                  {item.count.toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}

      {showEmpty && (
        <div className="search-overlay-empty">
          <span>No results for "{query}"</span>
        </div>
      )}

      <div className="search-overlay-footer">
        <span>
          <kbd>&#8593;&#8595;</kbd> navigate
          <kbd>&#9166;</kbd> select
          <kbd>esc</kbd> close
        </span>
      </div>
    </div>
  );
};
