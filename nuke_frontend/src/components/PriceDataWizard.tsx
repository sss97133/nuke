import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface PriceDataWizardProps {
  vehicleId: string;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type WizardStep = 'source_selection' | 'url_input' | 'ai_extraction' | 'review_confirm';

const PriceDataWizard: React.FC<PriceDataWizardProps> = ({
  vehicleId,
  isOpen,
  onClose,
  onComplete
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('source_selection');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [urls, setUrls] = useState<{ source: string; url: string }[]>([]);
  const [extractedData, setExtractedData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const sources = [
    { id: 'bat', name: 'Bring a Trailer', icon: 'BAT' },
    { id: 'cars_bids', name: 'Cars & Bids', icon: 'C&B' },
    { id: 'ebay', name: 'eBay Motors', icon: 'EB' },
    { id: 'facebook', name: 'Facebook Marketplace', icon: 'FB' },
    { id: 'hemmings', name: 'Hemmings', icon: 'HEM' },
    { id: 'craigslist', name: 'Craigslist', icon: 'CL' },
    { id: 'manual', name: 'Manual Entry', icon: 'MAN' },
  ];

  if (!isOpen) return null;

  const handleSourceToggle = (sourceId: string) => {
    setSelectedSources(prev =>
      prev.includes(sourceId)
        ? prev.filter(s => s !== sourceId)
        : [...prev, sourceId]
    );
  };

  const handleUrlAdd = (source: string, url: string) => {
    setUrls(prev => [...prev, { source, url }]);
  };

  const handleExtract = async () => {
    setLoading(true);
    try {
      // For now, create mock extracted data
      // In production, this would call an AI service
      const mockExtracted = urls.map(({ source, url }) => ({
        source,
        url,
        price: Math.floor(Math.random() * 50000) + 10000,
        date: new Date().toISOString(),
        confidence: Math.floor(Math.random() * 30) + 70,
        details: {
          listing_title: 'Vehicle Listing',
          seller: 'Private Seller',
          location: 'Unknown'
        }
      }));
      
      setExtractedData(mockExtracted);
      setCurrentStep('review_confirm');
    } catch (error) {
      console.error('Extraction failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      // Save each extracted price to the database
      for (const data of extractedData) {
        const { error } = await supabase.from('vehicle_field_sources').insert({
          vehicle_id: vehicleId,
          field_name: 'market_value',
          field_value: data.price.toString(),
          source_type: 'ai_scraped',
          source_name: data.source,
          confidence_score: data.confidence / 100, // Convert percentage to decimal
          verification_details: JSON.stringify(data.details),
          metadata: { url: data.url },
          updated_at: new Date().toISOString()
        });

        if (error) {
          console.error('Database insert error:', error);
          throw error;
        }
      }

      // Show success feedback
      alert(`Successfully saved ${extractedData.length} price data entries!`);
      onComplete();
    } catch (error) {
      console.error('Failed to save price data:', error);
      alert('Failed to save price data. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'source_selection':
        return (
          <div>
            <h3 className="text font-bold mb-4">Select Data Sources</h3>
            <p className="text-small text-muted mb-4">
              Choose which platforms you want to pull pricing data from:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {sources.map(source => (
                <label
                  key={source.id}
                  className={`card ${selectedSources.includes(source.id) ? 'selected' : ''}`}
                  style={{
                    cursor: 'pointer',
                    padding: '12px',
                    border: selectedSources.includes(source.id) 
                      ? '2px solid var(--color-primary)' 
                      : '1px solid var(--color-border)',
                    background: selectedSources.includes(source.id)
                      ? 'var(--color-primary-light)'
                      : 'white'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(source.id)}
                    onChange={() => handleSourceToggle(source.id)}
                    style={{ display: 'none' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 'bold', backgroundColor: '#f0f0f0', padding: '2px 4px', borderRadius: '2px' }}>{source.icon}</span>
                    <span className="text-small">{source.name}</span>
                  </div>
                </label>
              ))}
            </div>
            <div className="mt-4">
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                onClick={() => setCurrentStep('url_input')}
                disabled={selectedSources.length === 0}
              >
                Next: Add URLs
              </button>
            </div>
          </div>
        );

      case 'url_input':
        return (
          <div>
            <h3 className="text font-bold mb-4">Add Listing URLs</h3>
            <p className="text-small text-muted mb-4">
              Paste URLs from your selected sources. Our AI will extract pricing data.
            </p>
            {selectedSources.map(sourceId => {
              const source = sources.find(s => s.id === sourceId);
              return (
                <div key={sourceId} className="mb-4">
                  <label className="text-small font-bold">
                    {source?.icon} {source?.name}
                  </label>
                  <input
                    type="url"
                    className="input"
                    placeholder={`https://example.com/listing`}
                    onBlur={(e) => {
                      if (e.target.value) {
                        handleUrlAdd(sourceId, e.target.value);
                      }
                    }}
                    style={{ width: '100%', marginTop: '4px' }}
                  />
                </div>
              );
            })}
            <div className="mt-4" style={{ display: 'flex', gap: '8px' }}>
              <button
                className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                onClick={() => setCurrentStep('source_selection')}
              >
                Back
              </button>
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                onClick={handleExtract}
                disabled={urls.length === 0}
              >
                Extract Data
              </button>
            </div>
          </div>
        );

      case 'review_confirm':
        return (
          <div>
            <h3 className="text font-bold mb-4">Review Extracted Data</h3>
            <p className="text-small text-muted mb-4">
              Review the extracted price data before saving:
            </p>
            {extractedData.map((data, idx) => (
              <div key={idx} className="card mb-3" style={{ padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="text-small font-bold">
                      {sources.find(s => s.id === data.source)?.name}
                    </div>
                    <div className="text-large font-bold" style={{ color: 'var(--color-primary)' }}>
                      ${data.price.toLocaleString()}
                    </div>
                    <div className="text-small text-muted">
                      Confidence: {data.confidence}%
                    </div>
                  </div>
                  <button
                    className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600"
                    onClick={() => {
                      setExtractedData(prev => prev.filter((_, i) => i !== idx));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <div className="mt-4" style={{ display: 'flex', gap: '8px' }}>
              <button
                className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                onClick={() => setCurrentStep('url_input')}
              >
                Back
              </button>
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                onClick={handleSave}
                disabled={extractedData.length === 0}
              >
                Save Price Data
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div 
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="card"
        style={{
          width: '90%',
          maxWidth: '600px',
          maxHeight: '80vh',
          overflow: 'auto',
          background: 'var(--surface)'
        }}
      >
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Add Price Data Source</span>
          <button
            className="px-2 py-1 text-gray-500 hover:text-gray-700 text-lg font-bold"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="card-body">
          {loading ? (
            <div className="text-center">
              <div className="loading-spinner"></div>
              <p className="text-small text-muted mt-2">Processing...</p>
            </div>
          ) : (
            renderStep()
          )}
        </div>
      </div>
    </div>
  );
};

export default PriceDataWizard;
