/**
 * URL Data Drop Component
 * Allow trusted users to paste URLs and auto-backfill vehicle data
 * Supports BaT, eBay, Craigslist, etc.
 */

import React, { useState } from 'react';
import { listingURLParser } from '../../services/listingURLParser';
import { supabase } from '../../lib/supabase';

interface URLDataDropProps {
  vehicleId: string;
  onDataImported?: () => void;
}

export const URLDataDrop: React.FC<URLDataDropProps> = ({ vehicleId, onDataImported }) => {
  const [url, setUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);

  const handleURLPaste = async () => {
    if (!url.trim()) return;

    setParsing(true);
    setPreviewData(null);

    try {
      // Parse the URL
      const parsed = await listingURLParser.parseListingURL(url);
      
      // Show preview
      setPreviewData(parsed);

    } catch (error: any) {
      alert(`Error parsing URL: ${error.message}`);
    } finally {
      setParsing(false);
    }
  };

  const applyParsedData = async () => {
    if (!previewData) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      await listingURLParser.applyToVehicle(vehicleId, previewData, user.id);

      alert('Vehicle data updated successfully!');
      setUrl('');
      setPreviewData(null);
      
      if (onDataImported) {
        onDataImported();
      }

    } catch (error: any) {
      alert(`Error applying data: ${error.message}`);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h4 style={{ fontSize: '10pt', fontWeight: 700, margin: 0 }}>
          Quick Data Import
        </h4>
      </div>
      <div className="card-body">
        <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
          Paste a BaT/eBay/Craigslist URL to auto-fill vehicle data
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://bringatrailer.com/listing/..."
            className="form-input"
            style={{ flex: 1, fontSize: '9pt' }}
          />
          <button
            onClick={handleURLPaste}
            disabled={parsing || !url.trim()}
            className="button button-primary"
            style={{ fontSize: '9pt' }}
          >
            {parsing ? 'PARSING...' : 'PARSE'}
          </button>
        </div>

        {/* Preview Parsed Data */}
        {previewData && (
          <div style={{
            padding: '12px',
            background: 'var(--grey-100)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '9pt'
          }}>
            <div style={{ fontWeight: 700, marginBottom: '8px' }}>
              Extracted Data:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '4px' }}>
              {previewData.source && (
                <>
                  <div style={{ color: 'var(--text-muted)' }}>Source:</div>
                  <div style={{ fontWeight: 600 }}>{previewData.source.toUpperCase()}</div>
                </>
              )}
              {previewData.vin && (
                <>
                  <div style={{ color: 'var(--text-muted)' }}>VIN:</div>
                  <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{previewData.vin}</div>
                </>
              )}
              {previewData.year && (
                <>
                  <div style={{ color: 'var(--text-muted)' }}>Vehicle:</div>
                  <div>{previewData.year} {previewData.make} {previewData.model} {previewData.trim || ''}</div>
                </>
              )}
              {previewData.sold_price && (
                <>
                  <div style={{ color: 'var(--text-muted)' }}>Sold Price:</div>
                  <div style={{ fontWeight: 700, color: 'var(--success)' }}>
                    ${previewData.sold_price.toLocaleString()}
                  </div>
                </>
              )}
              {previewData.mileage && (
                <>
                  <div style={{ color: 'var(--text-muted)' }}>Mileage:</div>
                  <div>{previewData.mileage.toLocaleString()} mi</div>
                </>
              )}
              {previewData.seller && (
                <>
                  <div style={{ color: 'var(--text-muted)' }}>Seller:</div>
                  <div>{previewData.seller}</div>
                </>
              )}
              {previewData.images && previewData.images.length > 0 && (
                <>
                  <div style={{ color: 'var(--text-muted)' }}>Images:</div>
                  <div>{previewData.images.length} photos available</div>
                </>
              )}
            </div>

            <button
              onClick={applyParsedData}
              className="button button-primary"
              style={{ width: '100%', marginTop: '12px', fontSize: '9pt' }}
            >
              APPLY TO THIS VEHICLE
            </button>
          </div>
        )}

        {/* Quick Examples */}
        <div style={{
          fontSize: '8pt',
          color: 'var(--text-muted)',
          marginTop: '12px',
          padding: '8px',
          background: 'var(--grey-50)',
          borderRadius: '4px'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Supported Sources:</div>
          <div>• Bring a Trailer (full parse)</div>
          <div>• eBay Motors (VIN extraction)</div>
          <div>• Craigslist (basic parse)</div>
          <div>• Cars.com (VIN extraction)</div>
        </div>
      </div>
    </div>
  );
};

export default URLDataDrop;

