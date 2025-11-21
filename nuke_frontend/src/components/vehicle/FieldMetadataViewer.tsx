import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface FieldMetadata {
  field_name: string;
  field_value: string;
  validation_source: string;
  source_url: string | null;
  confidence_score: number;
  notes: string | null;
  created_at: string;
  validated_by: string | null;
}

interface FieldMetadataViewerProps {
  vehicleId: string;
  fieldName: string;
  fieldValue: string;
  fieldLabel: string;
  isOpen: boolean;
  onClose: () => void;
}

const FieldMetadataViewer: React.FC<FieldMetadataViewerProps> = ({
  vehicleId,
  fieldName,
  fieldValue,
  fieldLabel,
  isOpen,
  onClose
}) => {
  const [metadata, setMetadata] = useState<FieldMetadata[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMetadata = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('data_validations')
        .select('*')
        .eq('entity_type', 'vehicle')
        .eq('entity_id', vehicleId)
        .eq('field_name', fieldName)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setMetadata(data || []);
    } catch (error) {
      console.error('Error loading field metadata:', error);
    } finally {
      setLoading(false);
    }
  }, [vehicleId, fieldName]);

  useEffect(() => {
    console.log('[FieldMetadataViewer] useEffect:', { isOpen, vehicleId, fieldName });
    if (isOpen && vehicleId && fieldName) {
      loadMetadata();
    }
  }, [isOpen, vehicleId, fieldName, loadMetadata]);

  if (!isOpen) return null;

  const getConfidenceColor = (score: number) => {
    if (score >= 90) return '#22c55e'; // green
    if (score >= 70) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  const getSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      'bat_listing': 'BAT Listing',
      'manual_entry': 'Manual Entry',
      'user_input': 'User Input',
      'ai_extraction': 'AI Extraction',
      'document_scan': 'Document Scan',
      'url_scraper': 'URL Scraper',
      'api_import': 'API Import'
    };
    return labels[source] || source;
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          border: '2px solid var(--border)',
          borderRadius: '8px',
          padding: '20px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '2px solid var(--border)'
        }}>
          <h3 style={{ fontSize: '14pt', fontWeight: 700, margin: 0 }}>
            {fieldLabel} Data Source
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px 8px'
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '10pt', color: '#666', marginBottom: '4px' }}>Current Value</div>
          <div style={{ fontSize: '12pt', fontWeight: 600 }}>{fieldValue || 'Not set'}</div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>Loading metadata...</div>
        ) : metadata.length === 0 ? (
          <div style={{ 
            padding: '20px', 
            textAlign: 'center', 
            color: '#666',
            fontSize: '10pt'
          }}>
            No validation data found for this field.
            <div style={{ marginTop: '8px', fontSize: '9pt' }}>
              Data may have been entered manually or imported without validation tracking.
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '10pt', fontWeight: 600, marginBottom: '12px' }}>
              Validation History ({metadata.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {metadata.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '12px',
                    background: idx === 0 ? '#f9fafb' : 'white'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontSize: '10pt', fontWeight: 600, marginBottom: '4px' }}>
                        {getSourceLabel(item.validation_source)}
                        {idx === 0 && (
                          <span style={{
                            marginLeft: '8px',
                            fontSize: '8pt',
                            background: '#e0e7ff',
                            color: '#4338ca',
                            padding: '2px 6px',
                            borderRadius: '3px'
                          }}>
                            LATEST
                          </span>
                        )}
                      </div>
                      {item.source_url && (
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: '9pt',
                            color: 'var(--primary)',
                            textDecoration: 'underline'
                          }}
                        >
                          {item.source_url.length > 50 
                            ? item.source_url.substring(0, 50) + '...' 
                            : item.source_url}
                        </a>
                      )}
                    </div>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: '4px'
                    }}>
                      <div style={{
                        fontSize: '10pt',
                        fontWeight: 700,
                        color: getConfidenceColor(item.confidence_score)
                      }}>
                        {item.confidence_score}%
                      </div>
                      <div style={{ fontSize: '8pt', color: '#666' }}>
                        {new Date(item.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  
                  {item.notes && (
                    <div style={{
                      fontSize: '9pt',
                      color: '#666',
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: '1px solid #e5e7eb'
                    }}>
                      {item.notes}
                    </div>
                  )}

                  {item.field_value && item.field_value !== fieldValue && (
                    <div style={{
                      fontSize: '9pt',
                      color: '#dc2626',
                      marginTop: '8px',
                      padding: '6px',
                      background: '#fef2f2',
                      borderRadius: '3px'
                    }}>
                      ⚠️ Validation value: {item.field_value} (differs from current)
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: '1px solid var(--border)',
          fontSize: '9pt',
          color: '#666'
        }}>
          <div style={{ marginBottom: '4px' }}>
            <strong>Confidence Score:</strong> Higher scores indicate more reliable data sources.
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <div>
              <span style={{ color: '#22c55e' }}>●</span> 90-100%: High confidence
            </div>
            <div>
              <span style={{ color: '#eab308' }}>●</span> 70-89%: Medium confidence
            </div>
            <div>
              <span style={{ color: '#ef4444' }}>●</span> &lt;70%: Low confidence
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FieldMetadataViewer;

