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
      const sources: ValidationSource[] = [];

      // 0. VIN-specific: include conclusive, cited sources from data_validation_sources
      if (fieldName === 'vin') {
        const { data: vinSources } = await supabase
          .from('data_validation_sources')
          .select('id, source_type, source_image_id, source_url, confidence_score, extraction_method, verification_notes, created_at')
          .eq('vehicle_id', vehicleId)
          .eq('data_field', 'vin')
          .order('confidence_score', { ascending: false })
          .order('created_at', { ascending: false });

        if (vinSources && vinSources.length > 0) {
          const imageIds = vinSources.map((v: any) => v.source_image_id).filter(Boolean) as string[];
          const imageUrlById = new Map<string, string>();
          if (imageIds.length > 0) {
            const { data: images } = await supabase
              .from('vehicle_images')
              .select('id, thumbnail_url, medium_url, image_url')
              .in('id', imageIds);
            images?.forEach((img: any) => {
              imageUrlById.set(img.id, img.thumbnail_url || img.medium_url || img.image_url);
            });
          }

          vinSources.forEach((v: any) => {
            const imgUrl = v.source_image_id ? imageUrlById.get(v.source_image_id) : undefined;
            sources.push({
              validation_source: v.source_type || 'unknown_source',
              confidence_score: typeof v.confidence_score === 'number' ? v.confidence_score : 0,
              source_url: imgUrl || v.source_url || undefined,
              notes: [
                v.extraction_method ? `Method: ${v.extraction_method}` : null,
                v.verification_notes ? v.verification_notes : null
              ].filter(Boolean).join(' • '),
              created_at: v.created_at
            });
          });
        }
      }

      // 1. Get ownership verifications (title, registration uploads)
      const { data: ownershipDocs } = await supabase
        .from('ownership_verifications')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (ownershipDocs && ownershipDocs.length > 0) {
        ownershipDocs.forEach((doc: any) => {
          const docType = doc.document_type || 'document';
          sources.push({
            validation_source: docType === 'title' ? 'title_upload' : `${docType}_upload`,
            confidence_score: doc.verification_status === 'verified' ? 95 : 80,
            source_url: doc.document_url || doc.image_url,
            notes: `${docType.toUpperCase()} - ${doc.verification_status || 'pending'}`,
            validated_by: doc.verified_by,
            created_at: doc.created_at
          });
        });
      }

      // 2. Get vehicle images tagged as title/registration/VIN plate
      const { data: docImages } = await supabase
        .from('vehicle_images')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .in('sensitive_type', ['title', 'registration', 'vin_plate', 'bill_of_sale'])
        .order('created_at', { ascending: false });

      if (docImages && docImages.length > 0) {
        docImages.forEach((img: any) => {
          const docType = img.sensitive_type || 'document';
          sources.push({
            validation_source: `${docType}_image`,
            confidence_score: 85,
            source_url: img.image_url,
            notes: `Image tagged as ${docType.replace(/_/g, ' ')}`,
            validated_by: img.uploaded_by,
            created_at: img.created_at
          });
        });
      }

      // 3. Get field-specific validation sources from vehicle_field_sources
      const { data: fieldSources } = await supabase
        .from('vehicle_field_sources')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('field_name', fieldName)
        .order('updated_at', { ascending: false });

      if (fieldSources && fieldSources.length > 0) {
        fieldSources.forEach((source: any) => {
          sources.push({
            validation_source: source.source_type || 'user_input',
            confidence_score: source.confidence_score || 50,
            notes: `Value: ${source.field_value}`,
            validated_by: source.user_id,
            created_at: source.updated_at
          });
        });
      }

      // 4. Fallback: Get all validation sources for this field from data_validations table
      const { data: validationData } = await supabase
        .from('data_validations')
        .select('*')
        .eq('entity_type', 'vehicle')
        .eq('entity_id', vehicleId)
        .eq('field_name', fieldName)
        .order('confidence_score', { ascending: false });

      if (validationData && validationData.length > 0) {
        validationData.forEach((val: any) => {
          sources.push({
            validation_source: val.validation_source,
            confidence_score: val.confidence_score,
            source_url: val.source_url,
            notes: val.notes,
            validated_by: val.validated_by,
            created_at: val.created_at
          });
        });
      }

      setValidations(sources);

      // Calculate consensus from all sources
      if (sources.length > 0) {
        const avgConfidence = sources.reduce((sum, s) => sum + s.confidence_score, 0) / sources.length;
        const maxConfidence = Math.max(...sources.map(s => s.confidence_score));
        const uniqueSources = new Set(sources.map(s => s.validation_source));
        const uniqueValidators = new Set(sources.map(s => s.validated_by).filter(Boolean));

        setConsensus({
          field_name: fieldName,
          field_value: fieldValue,
          source_count: uniqueSources.size,
          validator_count: uniqueValidators.size,
          avg_confidence: avgConfidence,
          max_confidence: maxConfidence,
          sources: Array.from(uniqueSources),
          last_validated_at: sources[0].created_at
        });
      }
    } catch (err: any) {
      console.error('Error loading validations:', err);
    } finally {
      setLoading(false);
    }
  };

  const getSourceIcon = (source: string) => {
    // NO EMOJIS - use text labels only
    return '';
  };

  const isLikelyImageUrl = (url: string) => {
    const lower = url.toLowerCase();
    return lower.includes('/storage/v1/object/') && (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.gif')
    );
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
                          <span style={{ fontSize: '9pt', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
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
                          {isLikelyImageUrl(validation.source_url) && (
                            <a
                              href={validation.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'inline-block', marginBottom: '8px' }}
                              title="Open cited image in a new tab"
                            >
                              <img
                                src={validation.source_url}
                                alt="Cited proof"
                                style={{
                                  width: 160,
                                  maxWidth: '100%',
                                  height: 'auto',
                                  border: '1px solid var(--border)',
                                  borderRadius: 4,
                                  display: 'block'
                                }}
                              />
                            </a>
                          )}
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

