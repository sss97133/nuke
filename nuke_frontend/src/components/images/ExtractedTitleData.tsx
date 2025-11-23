/**
 * Extracted Title Data Display
 * Shows data extracted from vehicle titles/registrations
 * Only visible to authorized users
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ExtractedTitleDataProps {
  imageId: string;
  vehicleId: string;
}

interface TitleDocument {
  id: string;
  document_type: string;
  title_number?: string;
  vin?: string;
  state?: string;
  issue_date?: string;
  owner_name?: string;
  previous_owner_name?: string;
  lienholder_name?: string;
  odometer_reading?: number;
  odometer_date?: string;
  brand?: string;
  extraction_confidence?: number;
  is_verified: boolean;
  created_at: string;
}

export const ExtractedTitleData: React.FC<ExtractedTitleDataProps> = ({ imageId, vehicleId }) => {
  const [titleData, setTitleData] = useState<TitleDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTitleData();
  }, [imageId]);

  const fetchTitleData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('vehicle_title_documents')
        .select('*')
        .eq('image_id', imageId)
        .single();

      if (error) {
        // RLS will block if user doesn't have access
        if (error.code === 'PGRST116') {
          setError('No data available or access denied');
        } else {
          setError(error.message);
        }
        setTitleData(null);
      } else {
        setTitleData(data);
        setError(null);
      }
    } catch (err) {
      console.error('Error fetching title data:', err);
      setError('Failed to load document data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)' }}>
        <div className="text-muted" style={{ fontSize: '8pt' }}>Loading document data...</div>
      </div>
    );
  }

  if (error || !titleData) {
    return null; // Don't show anything if no data or no access
  }

  return (
    <div className="card" style={{ marginTop: 'var(--space-3)' }}>
      <div className="card-header">
        <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: 0 }}>
          Extracted {titleData.document_type.replace('_', ' ').toUpperCase()} Data
        </h3>
        {!titleData.is_verified && (
          <span
            style={{
              fontSize: '7pt',
              padding: '2px 6px',
              backgroundColor: 'var(--yellow-100)',
              border: '1px solid var(--yellow-600)',
              marginLeft: 'var(--space-2)'
            }}
          >
            UNVERIFIED
          </span>
        )}
      </div>
      
      <div className="card-body" style={{ fontSize: '8pt' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          {titleData.vin && (
            <div>
              <div className="text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>VIN</div>
              <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{titleData.vin}</div>
            </div>
          )}
          
          {titleData.title_number && (
            <div>
              <div className="text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>Title Number</div>
              <div style={{ fontWeight: 700 }}>{titleData.title_number}</div>
            </div>
          )}
          
          {titleData.state && (
            <div>
              <div className="text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>State</div>
              <div style={{ fontWeight: 700 }}>{titleData.state}</div>
            </div>
          )}
          
          {titleData.issue_date && (
            <div>
              <div className="text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>Issue Date</div>
              <div>{new Date(titleData.issue_date).toLocaleDateString()}</div>
            </div>
          )}
          
          {titleData.owner_name && (
            <div>
              <div className="text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>Owner Name</div>
              <div style={{ fontWeight: 700 }}>{titleData.owner_name}</div>
            </div>
          )}
          
          {titleData.previous_owner_name && (
            <div>
              <div className="text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>Previous Owner</div>
              <div style={{ color: 'var(--blue-600)' }}>{titleData.previous_owner_name}</div>
            </div>
          )}
          
          {titleData.lienholder_name && (
            <div>
              <div className="text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>Lienholder</div>
              <div>{titleData.lienholder_name}</div>
            </div>
          )}
          
          {titleData.odometer_reading && (
            <div>
              <div className="text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>Odometer</div>
              <div>{titleData.odometer_reading.toLocaleString()} miles</div>
            </div>
          )}
          
          {titleData.brand && (
            <div>
              <div className="text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>Brand</div>
              <div style={{ 
                fontWeight: 700,
                color: titleData.brand.toLowerCase() === 'clean' ? 'var(--green-600)' : 'var(--red-600)'
              }}>
                {titleData.brand.toUpperCase()}
              </div>
            </div>
          )}
        </div>
        
        {titleData.extraction_confidence && (
          <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border)' }}>
            <div className="text-muted" style={{ fontSize: '7pt' }}>
              Extraction Confidence: {Math.round(titleData.extraction_confidence * 100)}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

