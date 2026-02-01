/**
 * BAT Listing Extractor Component
 * 
 * Allows users to input a Bring a Trailer listing URL and extract
 * parts/brands information to legitimize vehicle modifications.
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface BATListingExtractorProps {
  vehicleId: string;
  onExtracted?: (count: number) => void;
}

export const BATListingExtractor: React.FC<BATListingExtractorProps> = ({
  vehicleId,
  onExtracted
}) => {
  const [batUrl, setBatUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; count?: number } | null>(null);
  const [existingParts, setExistingParts] = useState<any[]>([]);

  // Load existing BAT URL and extracted parts
  useEffect(() => {
    if (!vehicleId) return;

    // Try to get BAT URL from vehicle prop first (eliminates duplicate query)
    // Vehicle prop should have bat_auction_url if loaded via RPC
    // For now, we'll check window storage as fallback, but ideally vehicle prop should be passed
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

  const handleExtract = async () => {
    if (!batUrl || !batUrl.includes('bringatrailer.com')) {
      setResult({ success: false, message: 'Please enter a valid Bring a Trailer listing URL' });
      return;
    }

    setExtracting(true);
    setResult(null);

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
        setResult({
          success: true,
          message: data.message || `Extracted ${data.count || 0} parts/brands`,
          count: data.count
        });
        onExtracted?.(data.count || 0);
      } else {
        setResult({ success: false, message: data.error || 'Extraction failed' });
      }
    } catch (error: any) {
      console.error('BAT extraction error:', error);
      setResult({ success: false, message: error.message || 'Failed to extract parts/brands' });
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
        Extract Parts/Brands from BAT Listing
      </h4>
      <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
        Extract part names, brands, and modifications from Bring a Trailer listing descriptions.
        This will link to your image tags to provide provenance and legitimize part identifications.
      </p>

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
          onClick={handleExtract}
          disabled={extracting || !batUrl}
          style={{
            padding: '6px 16px',
            fontSize: '9pt',
            background: extracting ? 'var(--background-secondary)' : 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: extracting ? 'not-allowed' : 'pointer',
            opacity: extracting ? 0.6 : 1
          }}
        >
          {extracting ? 'Extracting...' : 'Extract'}
        </button>
      </div>

      {result && (
        <div style={{
          padding: '8px',
          background: result.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${result.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          borderRadius: '4px',
          fontSize: '8pt',
          color: result.success ? '#10b981' : '#ef4444'
        }}>
          {result.message}
          {result.success && result.count !== undefined && (
            <div style={{ marginTop: '4px', fontSize: '7pt', opacity: 0.8 }}>
              {result.count} parts/brands extracted and linked to image tags
            </div>
          )}
        </div>
      )}
    </div>
  );
};

