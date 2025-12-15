/**
 * BAT Listing Manager - Unified Component
 * 
 * Consolidates BaTURLDrop + BATListingExtractor into single component
 * Handles:
 * 1. Importing BAT listing data (VIN, specs, images)
 * 2. Extracting parts/brands from listing descriptions
 * 3. Linking extracted data to image tags
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface BATListingManagerProps {
  vehicleId: string;
  canEdit: boolean;
  onDataImported?: () => void;
}

export const BATListingManager: React.FC<BATListingManagerProps> = ({
  vehicleId,
  canEdit,
  onDataImported
}) => {
  const [batUrl, setBatUrl] = useState('');
  const [mode, setMode] = useState<'import' | 'extract'>('import'); // Import data or extract parts
  const [importing, setImporting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [existingParts, setExistingParts] = useState<any[]>([]);
  const [importResult, setImportResult] = useState<any>(null);

  if (!canEdit) return null;

  // Load existing BAT URL and extracted parts
  useEffect(() => {
    if (!vehicleId) return;

    // Try to get BAT URL from RPC data first (eliminates duplicate query)
    const rpcData = (window as any).__vehicleProfileRpcData;
    const vehicleFromWindow = rpcData?.vehicle;
    
    if (vehicleFromWindow?.bat_auction_url) {
      setBatUrl(vehicleFromWindow.bat_auction_url);
    } else if (vehicleFromWindow?.discovery_url && vehicleFromWindow.discovery_url.includes('bringatrailer.com')) {
      setBatUrl(vehicleFromWindow.discovery_url);
    } else {
      // Fallback: query if not in RPC data
      supabase
        .from('vehicles')
        .select('bat_auction_url, discovery_url')
        .eq('id', vehicleId)
        .single()
        .then(({ data }) => {
          if (data?.bat_auction_url) {
            setBatUrl(data.bat_auction_url);
          } else if (data?.discovery_url && data.discovery_url.includes('bringatrailer.com')) {
            setBatUrl(data.discovery_url);
          }
        });
    }

    // Get already extracted parts
    supabase
      .from('bat_listing_parts')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('extracted_at', { ascending: false })
      .then(({ data }) => {
        setExistingParts(data || []);
      });
  }, [vehicleId]);

  const handleImport = async () => {
    if (!batUrl || !batUrl.includes('bringatrailer.com')) {
      setError('Please enter a valid Bring a Trailer listing URL');
      return;
    }

    setImporting(true);
    setError('');
    setProgress('Importing complete BaT data with AI...');

    try {
      // Canonical BaT import (images + structured data)
      const { data, error } = await supabase.functions.invoke('complete-bat-import', {
        body: { bat_url: batUrl, vehicle_id: vehicleId }
      });
      
      if (error) throw error;
      if (!data?.success) throw new Error('Import failed');
      
      setImportResult(data);
      setProgress(`✅ Imported: ${data.imported?.timeline_events || 0} events, ${data.imported?.modifications || 0} mods, ${data.imported?.specs_updated || 0} specs`);
      
      // Refresh page after 2 seconds to show new data
      setTimeout(() => {
        if (onDataImported) onDataImported();
        window.location.reload();
      }, 2000);
      
    } catch (err: any) {
      console.error('Import error:', err);
      setError(err.message || 'Failed to import listing');
      setProgress('');
    } finally {
      setImporting(false);
    }
  };

  const handleExtract = async () => {
    if (!batUrl || !batUrl.includes('bringatrailer.com')) {
      setError('Please enter a valid Bring a Trailer listing URL');
      return;
    }

    setExtracting(true);
    setError('');

    try {
      const { data, error } = await supabase.functions.invoke('extract-bat-parts-brands', {
        body: {
          vehicleId,
          batListingUrl: batUrl,
          linkToImageTags: true
        }
      });

      if (error) throw error;

      if (data.success) {
        setProgress(`✅ Extracted ${data.count || 0} parts/brands from BAT listing`);
        // Reload existing parts
        const { data: parts } = await supabase
          .from('bat_listing_parts')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('extracted_at', { ascending: false });
        setExistingParts(parts || []);
        onDataImported?.();
      } else {
        setError(data.error || 'Extraction failed');
      }
    } catch (error: any) {
      console.error('BAT extraction error:', error);
      setError(error.message || 'Failed to extract parts/brands');
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div style={{
      padding: '16px',
      background: 'var(--background-secondary)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      marginBottom: '16px'
    }}>
      <h4 style={{ fontSize: '10pt', fontWeight: 600, marginBottom: '12px' }}>
        Bring a Trailer Listing Manager
      </h4>
      <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
        Import vehicle data or extract parts/brands from Bring a Trailer listings.
        This provides provenance and legitimizes vehicle modifications.
      </p>

      {/* Mode Toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          onClick={() => setMode('import')}
          style={{
            padding: '6px 12px',
            fontSize: '9pt',
            background: mode === 'import' ? 'var(--color-primary)' : 'var(--background-secondary)',
            color: mode === 'import' ? '#fff' : 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Import Data
        </button>
        <button
          onClick={() => setMode('extract')}
          style={{
            padding: '6px 12px',
            fontSize: '9pt',
            background: mode === 'extract' ? 'var(--color-primary)' : 'var(--background-secondary)',
            color: mode === 'extract' ? '#fff' : 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Extract Parts/Brands
        </button>
      </div>

      {/* Existing Parts Display */}
      {existingParts.length > 0 && (
        <div style={{
          marginBottom: '12px',
          padding: '8px',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '4px',
          fontSize: '8pt'
        }}>
          <strong>Already extracted:</strong> {existingParts.length} parts/brands from this listing
          <div style={{ marginTop: '4px', fontSize: '7pt', opacity: 0.8 }}>
            {existingParts.slice(0, 3).map((p, i) => (
              <span key={i}>
                {p.part_name}{p.brand_name ? ` (${p.brand_name})` : ''}
                {i < Math.min(2, existingParts.length - 1) ? ', ' : ''}
              </span>
            ))}
            {existingParts.length > 3 && ` +${existingParts.length - 3} more`}
          </div>
        </div>
      )}

      {/* URL Input */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <input
          type="url"
          value={batUrl}
          onChange={(e) => setBatUrl(e.target.value)}
          placeholder="https://bringatrailer.com/listing/..."
          style={{
            flex: 1,
            padding: '6px 12px',
            fontSize: '9pt',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontFamily: 'inherit'
          }}
        />
        <button
          onClick={mode === 'import' ? handleImport : handleExtract}
          disabled={(mode === 'import' ? importing : extracting) || !batUrl}
          style={{
            padding: '6px 16px',
            fontSize: '9pt',
            background: (mode === 'import' ? importing : extracting) ? 'var(--background-secondary)' : 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: (mode === 'import' ? importing : extracting) ? 'not-allowed' : 'pointer',
            opacity: (mode === 'import' ? importing : extracting) ? 0.6 : 1
          }}
        >
          {mode === 'import' 
            ? (importing ? 'Importing...' : 'Import Data')
            : (extracting ? 'Extracting...' : 'Extract Parts')
          }
        </button>
      </div>

      {/* Progress/Error Messages */}
      {progress && (
        <div style={{
          padding: '8px',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '4px',
          fontSize: '8pt',
          color: '#10b981',
          marginTop: '8px'
        }}>
          {progress}
        </div>
      )}

      {error && (
        <div style={{
          padding: '8px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '4px',
          fontSize: '8pt',
          color: '#ef4444',
          marginTop: '8px'
        }}>
          {error}
        </div>
      )}

      {/* Import Result Summary */}
      {importResult && (
        <div style={{
          marginTop: '12px',
          padding: '12px',
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '4px',
          fontSize: '8pt'
        }}>
          <strong>Import Summary:</strong>
          <div style={{ marginTop: '6px', fontSize: '7pt', opacity: 0.9 }}>
            {importResult.imported?.timeline_events > 0 && (
              <div>• {importResult.imported.timeline_events} timeline events</div>
            )}
            {importResult.imported?.modifications > 0 && (
              <div>• {importResult.imported.modifications} modifications</div>
            )}
            {importResult.imported?.specs_updated > 0 && (
              <div>• {importResult.imported.specs_updated} specs updated</div>
            )}
            {importResult.imported?.images > 0 && (
              <div>• {importResult.imported.images} images imported</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

