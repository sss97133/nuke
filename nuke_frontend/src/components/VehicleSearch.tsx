import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AIModelSelector, { AIProvider } from './search/AIModelSelector';
import '../design-system.css';

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

export default function VehicleSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedAIProvider, setSelectedAIProvider] = useState<AIProvider | undefined>();
  const navigate = useNavigate();

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm.trim().length > 0) {
        performSearch();
      } else {
        setResults([]);
        setShowResults(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const performSearch = async () => {
    try {
      setLoading(true);
      const searchLower = searchTerm.toLowerCase();

      // Search vehicles table
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
          vehicle_images!left(image_url, is_primary, variants)
        `)
        .eq('is_public', true)
        .or(`make.ilike.%${searchLower}%,model.ilike.%${searchLower}%,year.eq.${parseInt(searchTerm) || 0}`)
        .limit(20);

      if (error) {
        console.error('Search error:', error);
        return;
      }

      // Process results to get primary images
      const processedResults = (data || []).map(vehicle => {
        const primaryImage = vehicle.vehicle_images?.find((img: any) => img.is_primary) || vehicle.vehicle_images?.[0];
        const imageUrl = primaryImage?.variants?.medium || primaryImage?.image_url;

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
        padding: '2px 6px',
        height: '12px'
      }}>
        <span style={{ 
          fontSize: '7pt', 
          marginRight: '4px',
          color: '#999',
          fontFamily: '"MS Sans Serif", sans-serif',
          whiteSpace: 'nowrap',
          lineHeight: '1'
        }}>
          search
        </span>
        <input
          type="text"
          placeholder=""
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setShowResults(true);
          }}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: '7pt',
            fontFamily: '"MS Sans Serif", sans-serif',
            background: 'transparent',
            minWidth: 0,
            height: '100%',
            padding: 0,
            lineHeight: '1'
          }}
        />
        {/* AI Model Selector - Small Button */}
        <AIModelSelector
          onModelSelect={handleAIModelSelect}
          selectedProvider={selectedAIProvider}
        />
        {loading && <span style={{ fontSize: '6pt', color: 'var(--text-muted)', whiteSpace: 'nowrap', lineHeight: '1' }}>...</span>}
      </div>

      {/* Search Results Dropdown */}
      {showResults && results.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--white)',
            border: '2px solid var(--border)',
            borderTop: 'none',
            maxHeight: '400px',
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '2px 2px 8px rgba(0,0,0,0.2)'
          }}
        >
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
                    fontSize: '24pt',
                    color: 'var(--text-muted)'
                  }}>
                    🚗
                  </div>
                )}
              </div>

              {/* Vehicle Info */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '4px' }}>
                  {result.year} {result.make} {result.model}
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {result.color && <span>{result.color} · </span>}
                  {result.mileage && <span>{result.mileage.toLocaleString()} mi</span>}
                  {result.vin && <span> · VIN: {result.vin.slice(-6)}</span>}
                </div>
                {result.is_for_sale && result.asking_price && (
                  <div style={{
                    fontSize: '9pt',
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
      {showResults && results.length === 0 && searchTerm.length > 0 && !loading && (
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
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
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
