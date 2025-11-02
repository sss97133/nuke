import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ValidationSource {
  validation_source: string;
  confidence_score: number;
  source_url?: string;
  notes?: string;
  validated_by?: string;
  created_at: string;
}

interface ValidationConsensus {
  field_name: string;
  field_value: string;
  source_count: number;
  validator_count: number;
  avg_confidence: number;
  max_confidence: number;
  sources: string[];
  last_validated_at: string;
}

interface DataValidationPopupProps {
  vehicleId: string;
  fieldName: string;
  fieldValue: string;
  onClose: () => void;
}

const DataValidationPopup: React.FC<DataValidationPopupProps> = ({
  vehicleId,
  fieldName,
  fieldValue,
  onClose
}) => {
  const [validations, setValidations] = useState<ValidationSource[]>([]);
  const [consensus, setConsensus] = useState<ValidationConsensus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadValidations();
  }, [vehicleId, fieldName]);

  const loadValidations = async () => {
    try {
      setLoading(true);

      // Get all validation sources for this field
      const { data: validationData, error: validationError } = await supabase
        .from('data_validations')
        .select('*')
        .eq('entity_type', 'vehicle')
        .eq('entity_id', vehicleId)
        .eq('field_name', fieldName)
        .order('confidence_score', { ascending: false });

      if (validationError) throw validationError;
      setValidations(validationData || []);

      // Get consensus view
      const { data: consensusData, error: consensusError } = await supabase
        .from('data_validation_consensus')
        .select('*')
        .eq('entity_type', 'vehicle')
        .eq('entity_id', vehicleId)
        .eq('field_name', fieldName)
        .single();

      if (!consensusError && consensusData) {
        setConsensus(consensusData);
      }
    } catch (err: any) {
      console.error('Error loading validations:', err);
    } finally {
      setLoading(false);
    }
  };

  const getSourceIcon = (source: string) => {
    const icons: Record<string, string> = {
      'bat_listing': '🏛️',
      'deal_jacket': '📋',
      'title_document': '📜',
      'vin_decoder': '🔍',
      'expert_appraisal': '👔',
      'receipt': '🧾',
      'maintenance_record': '🔧',
      'insurance_doc': '🛡️',
      'registration': '🚗',
      'user_input': '✏️',
      'crowdsourced_consensus': '👥'
    };
    return icons[source] || '📄';
  };

  const getSourceLabel = (source: string) => {
    return source.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 95) return '#10b981'; // green
    if (score >= 80) return '#3b82f6'; // blue
    if (score >= 60) return '#f59e0b'; // orange
    return '#ef4444'; // red
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: '90%',
          maxWidth: '600px',
          maxHeight: '80vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
            Validation: {fieldName.replace(/_/g, ' ').toUpperCase()}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '18pt',
              cursor: 'pointer',
              padding: '0 8px'
            }}
          >
            ×
          </button>
        </div>

        <div className="card-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>Loading validation data...</div>
          ) : (
            <>
              {/* Field Value */}
              <div style={{
                padding: '12px',
                background: 'var(--bg-secondary)',
                border: '2px solid var(--accent)',
                borderRadius: '4px',
                marginBottom: '16px'
              }}>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Current Value</div>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{fieldValue}</div>
              </div>

              {/* Consensus Summary */}
              {consensus && (
                <div style={{
                  padding: '12px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '4px',
                  marginBottom: '16px'
                }}>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Sources</div>
                      <div style={{ fontSize: '12pt', fontWeight: 700 }}>{consensus.source_count}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Validators</div>
                      <div style={{ fontSize: '12pt', fontWeight: 700 }}>{consensus.validator_count}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Avg Confidence</div>
                      <div style={{
                        fontSize: '12pt',
                        fontWeight: 700,
                        color: getConfidenceColor(consensus.avg_confidence)
                      }}>
                        {Math.round(consensus.avg_confidence)}%
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Validation Sources */}
              <div style={{ marginBottom: '8px', fontSize: '10pt', fontWeight: 700 }}>
                Validation Sources ({validations.length})
              </div>

              {validations.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  No validation data yet. This field was manually entered but not verified by multiple sources.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {validations.map((validation, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '12px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        background: 'var(--white)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '14pt' }}>{getSourceIcon(validation.validation_source)}</span>
                          <span style={{ fontSize: '9pt', fontWeight: 700 }}>
                            {getSourceLabel(validation.validation_source)}
                          </span>
                        </div>
                        <div style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          background: getConfidenceColor(validation.confidence_score),
                          color: '#fff',
                          fontSize: '8pt',
                          fontWeight: 700
                        }}>
                          {validation.confidence_score}% confidence
                        </div>
                      </div>

                      {validation.notes && (
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          {validation.notes}
                        </div>
                      )}

                      {validation.source_url && (
                        <div style={{ marginTop: '6px' }}>
                          <a
                            href={validation.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '8pt',
                              color: 'var(--accent)',
                              textDecoration: 'none'
                            }}
                            className="hover:underline"
                          >
                            View Source →
                          </a>
                        </div>
                      )}

                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '6px' }}>
                        Validated {new Date(validation.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add New Validation */}
              <div style={{
                marginTop: '16px',
                padding: '12px',
                background: 'var(--bg-secondary)',
                borderRadius: '4px',
                border: '1px dashed var(--border)'
              }}>
                <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
                  Have additional proof?
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  Upload a title, receipt, or registration to add another validation source and increase confidence.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DataValidationPopup;

