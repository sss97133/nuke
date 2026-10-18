import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  buildFacetDrilldownUrl,
  resolveMarketCohortShortcuts,
  type MarketCohortShortcut,
} from '../lib/market/vehicleTaxonomy';
import AIModelSelector from './search/AIModelSelector';
import type { AIProvider } from './search/AIModelSelector';
import '../styles/unified-design-system.css';

interface SearchResult {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  color: string | null;
  mileage: number | null;
  asking_price: number | null;
  is_for_sale: boolean;
  image_url: string | null;
}

// Get fallback images from origin metadata
const getOriginImages = (vehicle: any): string[] => {
  const raw = vehicle?.origin_metadata?.images;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((url: any) => typeof url === 'string')
    .map((url: string) => url.trim())
    .filter((url: string) => url.startsWith('http'))
    .filter((url: string) => !url.includes('94x63'))
    .filter((url: string) => !url.includes('youtube.com'))
    .filter((url: string) => !url.toLowerCase().includes('thumbnail'));
};

export default function VehicleSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedAIProvider, setSelectedAIProvider] = useState<AIProvider | undefined>();
  const navigate = useNavigate();

  const cohortShortcuts = useMemo(
    () => resolveMarketCohortShortcuts(searchTerm, 3),
    [searchTerm],
  );

  useEffect(() => {
    if (searchTerm.trim().length >= 2 && cohortShortcuts.length > 0) {
      setShowResults(true);
    }
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm.trim().length > 0) {
        performSearch();
      } else {
        setResults([]);
        setShowResults(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, cohortShortcuts.length]);

  const performSearch = async () => {
    try {
      setLoading(true);
      const escapeILike = (s: string) => String(s || '').replace(/([%_\\])/g, '\\$1');
      const searchLower = searchTerm.toLowerCase();
      const searchLowerSafe = escapeILike(searchLower);

      // Search vehicles table - simplified query without broken image joins
      const { data, error } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          vin,
          color,
          mileage,
          asking_price,
          is_for_sale,
          origin_metadata
        `)
        .eq('is_public', true)
        .or(`make.ilike.%${searchLowerSafe}%,model.ilike.%${searchLowerSafe}%,year.eq.${parseInt(searchTerm) || 0}`)
        .limit(50);

      if (error) {
        console.error('Search error:', error);
        return;
      }

      // Process results with fallback to origin_metadata images
      const processedResults = (data || []).map(vehicle => {
        // Try origin_metadata images as fallback
        const originImages = getOriginImages(vehicle);
        const imageUrl = originImages[0] || null;

        return {
          id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          color: vehicle.color,
          mileage: vehicle.mileage,
          asking_price: vehicle.asking_price,
          is_for_sale: vehicle.is_for_sale,
          image_url: imageUrl
        };
      });

      setResults(processedResults);
      setShowResults(true);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResultClick = (vehicleId: string) => {
    navigate(`/vehicle/${vehicleId}`);
    setSearchTerm('');
    setShowResults(false);
  };

  const handleCohortShortcutClick = (shortcut: MarketCohortShortcut) => {
    const targetUrl =
      shortcut.url ||
      buildFacetDrilldownUrl({
        make: shortcut.make,
        family: shortcut.family,
        axis: shortcut.axis,
        facet: shortcut.facet,
      });
    navigate(targetUrl);
    setSearchTerm('');
    setShowResults(false);
  };

  const handleAIModelSelect = (provider: AIProvider, modelName: string, enabled: boolean) => {
    if (enabled) {
      setSelectedAIProvider(provider);
      // TODO: Integrate AI model selection with search
      console.log('AI model enabled:', provider, modelName);
    } else {
      setSelectedAIProvider(undefined);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '600px' }}>
      {/* Search Input with AI Model Selector */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'var(--white)',
        border: '2px solid var(--border)',
        padding: '4px 8px',
        height: '30px'
      }}>
        <span style={{ 
          fontSize: '12px', 
          marginRight: '4px',
          color: 'var(--text-disabled)',
          fontFamily: 'Arial, sans-serif',
          whiteSpace: 'nowrap'
        }}>
          search
        </span>
        <input
          type="text"
          placeholder=""
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => {
            if (results.length > 0 || cohortShortcuts.length > 0) setShowResults(true);
          }}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: '12px',
            fontFamily: 'Arial, sans-serif',
            background: 'transparent',
            minWidth: 0,
            height: '100%',
            padding: 0
          }}
        />
        {/* AI Model Selector - Small Button */}
        <AIModelSelector
          onModelSelect={handleAIModelSelect}
          selectedProvider={selectedAIProvider}
        />
        {loading && <span style={{ fontSize: '9px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>...</span>}
      </div>

      {/* Search Results Dropdown */}
      {showResults && (cohortShortcuts.length > 0 || results.length > 0) && (
        <div
          data-testid="vehicle-search-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--white)',
            border: '2px solid var(--border)',
            borderTop: 'none',
            maxHeight: '420px',
            overflowY: 'auto',
            zIndex: 1000,
          }}
        >
          {/* Market Cohort Shortcuts Section */}
          {cohortShortcuts.length > 0 && (
            <div
              data-testid="market-cohort-shortcuts-section"
              style={{
                borderBottom: results.length > 0 ? '2px solid var(--border)' : 'none',
                background: 'var(--surface, #FAFAFA)',
              }}
            >
              <div
                style={{
                  padding: '6px 12px',
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--border-light)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>MARKET COHORT SHORTCUTS</span>
                <span>FACET DRILLDOWN</span>
              </div>
              {cohortShortcuts.map((shortcut) => (
                <div
                  key={shortcut.id}
                  data-testid={`market-cohort-shortcut-${shortcut.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleCohortShortcutClick(shortcut)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleCohortShortcutClick(shortcut);
                    }
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--grey-100)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--border-light)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  {/* Inline Era-Accurate Vetted Identity Mark SVG */}
                  <div
                    data-testid="market-cohort-shortcut-svg"
                    style={{
                      width: '78px',
                      height: '22px',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    dangerouslySetInnerHTML={{ __html: shortcut.svgMarkup }}
                  />

                  {/* Cohort Title & Sublabel */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      data-testid="market-cohort-shortcut-label"
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--text, #111)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {shortcut.make} {shortcut.family} · {shortcut.axisDisplayLabel}: {shortcut.facet}
                    </div>
                    <div
                      style={{
                        fontSize: '9px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {shortcut.subLabel}
                    </div>
                  </div>

                  {/* Era Range Badge + MARKET MAP ↗ Pill */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexShrink: 0,
                    }}
                  >
                    {shortcut.yearRangeLabel && (
                      <span
                        data-testid="market-cohort-shortcut-era"
                        style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '2px 5px',
                          border: '1px solid var(--border)',
                          background: 'var(--white)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {shortcut.yearRangeLabel}
                      </span>
                    )}
                    <span
                      data-testid="market-cohort-shortcut-pill"
                      style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        border: '1px solid var(--border)',
                        background: 'var(--text, #111)',
                        color: 'var(--white, #FFF)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      MARKET MAP ↗
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.map(result => (
            <div
              key={result.id}
              onClick={() => handleResultClick(result.id)}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              style={{
                padding: '12px',
                borderBottom: '1px solid var(--border-light)',
                cursor: 'pointer',
                display: 'flex',
                gap: '12px',
                alignItems: 'center'
              }}
            >
              {/* Thumbnail */}
              <div style={{
                width: '80px',
                height: '60px',
                background: result.image_url ? `url(${result.image_url})` : 'var(--grey-200)',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                border: '1px solid var(--border)',
                flexShrink: 0
              }}>
                {!result.image_url && (
                  <div style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '32px',
                    color: 'var(--text-muted)'
                  }}>
                    🚗
                  </div>
                )}
              </div>

              {/* Vehicle Info */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '4px' }}>
                  {result.year} {result.make} {result.model}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {result.color && <span>{result.color} · </span>}
                  {result.mileage && <span>{result.mileage.toLocaleString()} mi</span>}
                  {result.vin && <span> · VIN: {result.vin.slice(-6)}</span>}
                </div>
                {result.is_for_sale && result.asking_price && (
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: '#008000',
                    marginTop: '4px'
                  }}>
                    ${result.asking_price.toLocaleString()} · FOR SALE
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No Results */}
      {showResults && results.length === 0 && cohortShortcuts.length === 0 && searchTerm.length > 0 && !loading && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'var(--white)',
          border: '2px solid var(--border)',
          borderTop: 'none',
          padding: '24px',
          textAlign: 'center',
          zIndex: 1000
        }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            No vehicles found for "{searchTerm}"
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {showResults && (
        <div
          onClick={() => setShowResults(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
        />
      )}
    </div>
  );
}
