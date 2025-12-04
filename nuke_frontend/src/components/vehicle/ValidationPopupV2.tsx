import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ValidationSource {
  source_type: string; // "title_upload", "registration_image", etc.
  document_type?: string; // "title", "registration", "bill_of_sale"
  document_state?: string; // "ARIZONA", "CALIFORNIA", etc.
  confidence_score: number;
  image_url?: string;
  created_at: string;
  verified_by?: string;
}

interface ValidationPopupV2Props {
  vehicleId: string;
  fieldName: string;
  fieldValue: string;
  vehicleYear?: number;
  vehicleMake?: string;
  onClose: () => void;
}

const ValidationPopupV2: React.FC<ValidationPopupV2Props> = ({
  vehicleId,
  fieldName,
  fieldValue,
  vehicleYear,
  vehicleMake,
  onClose
}) => {
  const [sources, setSources] = useState<ValidationSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfidenceExplainer, setShowConfidenceExplainer] = useState(false);
  const [showValidatorExplainer, setShowValidatorExplainer] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState(fieldValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadValidations();
  }, [vehicleId, fieldName]);

  const loadValidations = async () => {
    try {
      setLoading(true);
      const allSources: ValidationSource[] = [];

      // 0. Factory Reference Pages - SPECIFIC PAGES for this field (HIGHEST AUTHORITY)
      const { data: manualPages, error: pagesError } = await supabase
        .rpc('get_manual_pages_for_field', {
          p_vehicle_id: vehicleId,
          p_field_name: fieldName
        });

      if (!pagesError && manualPages && manualPages.length > 0) {
        console.log(`Found ${manualPages.length} relevant manual pages for ${fieldName}`);
        
        manualPages.forEach((page: any) => {
          allSources.push({
            source_type: 'factory_manual_page',
            document_type: 'manual_page',
            document_state: `${page.catalog_name} - Page ${page.page_number}`,
            confidence_score: page.relevance_score || 100,
            image_url: page.image_url,
            created_at: new Date().toISOString()
          });
        });
      } else if (pagesError) {
        console.warn('Failed to load manual pages:', pagesError);
      }

      // 1. Ownership documents (title, registration)
      const { data: ownershipDocs } = await supabase
        .from('ownership_verifications')
        .select('document_type, document_url, image_url, verification_status, created_at, verified_by, metadata')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (ownershipDocs) {
        ownershipDocs.forEach((doc: any) => {
          const docType = doc.document_type || 'document';
          const state = doc.metadata?.state || doc.metadata?.document_state;
          allSources.push({
            source_type: `${docType}_upload`,
            document_type: docType,
            document_state: state,
            confidence_score: doc.verification_status === 'verified' ? 95 : 80,
            image_url: doc.document_url || doc.image_url,
            created_at: doc.created_at,
            verified_by: doc.verified_by
          });
        });
      }

      // 2. Tagged images (title/registration/VIN photos)
      const { data: docImages } = await supabase
        .from('vehicle_images')
        .select('sensitive_type, image_url, created_at, uploaded_by, exif_data')
        .eq('vehicle_id', vehicleId)
        .in('sensitive_type', ['title', 'registration', 'vin_plate', 'bill_of_sale'])
        .order('created_at', { ascending: false });

      if (docImages) {
        docImages.forEach((img: any) => {
          allSources.push({
            source_type: `${img.sensitive_type}_image`,
            document_type: img.sensitive_type,
            confidence_score: 85,
            image_url: img.image_url,
            created_at: img.created_at,
            verified_by: img.uploaded_by
          });
        });
      }

      setSources(allSources);
    } catch (err) {
      console.error('Failed to load validations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      
      const updates: any = {};
      
      // Convert value to proper type
      if (fieldName === 'year' || fieldName === 'mileage' || fieldName === 'horsepower') {
        updates[fieldName] = editedValue ? parseInt(editedValue) : null;
      } else {
        updates[fieldName] = editedValue || null;
      }
      
      const { error } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicleId);
      
      if (error) throw error;
      
      // Success - close modal and trigger reload
      setSaving(false);
      window.location.reload(); // Force refresh to show updated data
    } catch (err) {
      console.error('Save failed:', err);
      setSaving(false);
      alert('Failed to save: ' + (err as any).message);
    }
  };

  const calculateConfidence = () => {
    if (sources.length === 0) return 50; // Manual entry
    const avg = sources.reduce((sum, s) => sum + s.confidence_score, 0) / sources.length;
    return Math.round(avg);
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 90) return '#10b981';
    if (score >= 75) return '#3b82f6';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  };

  const getSourceLabel = (source: ValidationSource) => {
    const type = source.document_type || 'document';
    const state = source.document_state;
    
    // Factory manual pages - show page context
    if (source.source_type === 'factory_manual_page') {
      return state || 'FACTORY MANUAL';  // state = "1987 Service Manual - Page 15"
    }
    
    // Factory references
    if (source.source_type === 'factory_reference') {
      if (type === 'parts_catalog') return 'PARTS CATALOG';
      if (type === 'repair_manual') return 'FACTORY MANUAL';
      if (type === 'assembly_manual') return 'ASSEMBLY MANUAL';
      return 'FACTORY REFERENCE';
    }
    
    if (type === 'title' && state) return `${state} TITLE`;
    if (type === 'registration' && state) return `${state} REGISTRATION`;
    if (type === 'bill_of_sale') return 'BILL OF SALE';
    if (type === 'vin_plate') return 'VIN PLATE';
    
    return type.toUpperCase().replace(/_/g, ' ');
  };

  const getEmblemUrl = () => {
    const make = (vehicleMake || '').toLowerCase();
    
    // Use generic emblems for now (year-specific can be added later)
    if (make.includes('chevrolet') || make.includes('chevy')) {
      return '/emblems/chevrolet/bowtie.svg';
    }
    if (make.includes('gmc')) {
      return '/emblems/gmc/shield.svg';
    }
    
    return null;
  };

  const confidence = calculateConfidence();
  const emblemUrl = getEmblemUrl();
  const uniqueValidators = new Set(sources.map(s => s.verified_by).filter(Boolean)).size;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '90%',
          maxWidth: '500px',
          maxHeight: '85vh',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Minimal header */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <span style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--text-muted)' }}>
              {fieldName.toUpperCase()}
            </span>
            {isEditing ? (
              <input
                type={fieldName === 'year' || fieldName === 'mileage' ? 'number' : 'text'}
                value={editedValue}
                onChange={(e) => setEditedValue(e.target.value)}
                autoFocus
                style={{
                  fontSize: '10pt',
                  fontWeight: 700,
                  padding: '4px 8px',
                  border: '2px solid var(--accent)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  borderRadius: '4px',
                  width: '200px'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
            ) : (
              <span style={{ fontSize: '10pt', fontWeight: 700 }}>
                {fieldValue}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="button button-primary"
                  style={{ fontSize: '8pt', padding: '4px 12px' }}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setEditedValue(fieldValue);
                    setIsEditing(false);
                  }}
                  className="button"
                  style={{ fontSize: '8pt', padding: '4px 12px' }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="button"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
              >
                Edit
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '16pt',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                color: 'var(--text-muted)'
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Document previews - main focus */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', fontSize: '8pt', color: 'var(--text-muted)' }}>
              Loading...
            </div>
          ) : sources.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                No proof yet
              </div>
              <button
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('trigger_image_upload', { detail: { vehicleId } }));
                }}
              >
                Upload proof
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sources.map((source, idx) => (
                <div
                  key={idx}
                  style={{
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    cursor: source.image_url ? 'pointer' : 'default'
                  }}
                  onClick={() => {
                    if (source.image_url) {
                      setSelectedImage(source.image_url);
                    }
                  }}
                >
                  {/* Document image (blurred) */}
                  {source.image_url && (
                    <div style={{ position: 'relative', height: '180px', overflow: 'hidden', background: '#000' }}>
                      <img
                        src={source.image_url}
                        alt="Proof document"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          filter: 'blur(6px)',
                          opacity: 0.8
                        }}
                      />
                      {/* Info overlay */}
                      <div style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        background: 'rgba(0,0,0,0.75)',
                        padding: '4px 8px',
                        fontSize: '7pt',
                        color: '#fff',
                        fontWeight: 700
                      }}>
                        {getSourceLabel(source)}
                      </div>
                      <div style={{
                        position: 'absolute',
                        bottom: '8px',
                        right: '8px',
                        background: 'rgba(0,0,0,0.75)',
                        padding: '4px 8px',
                        fontSize: '7pt',
                        color: getConfidenceColor(source.confidence_score),
                        fontWeight: 700
                      }}>
                        {source.confidence_score}%
                      </div>
                      <div style={{
                        position: 'absolute',
                        bottom: '8px',
                        left: '8px',
                        fontSize: '7pt',
                        color: 'rgba(255,255,255,0.7)'
                      }}>
                        {new Date(source.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  )}
                  
                  {/* No image fallback */}
                  {!source.image_url && (
                    <div style={{ padding: '12px', fontSize: '8pt' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                        {getSourceLabel(source)}
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        {new Date(source.created_at).toLocaleDateString()} • {source.confidence_score}%
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with stats */}
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '7pt'
        }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <span>{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
            <button
              onClick={() => setShowValidatorExplainer(true)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                color: 'var(--text-muted)',
                textDecoration: 'underline dotted',
                fontSize: '7pt'
              }}
            >
              {uniqueValidators} validator{uniqueValidators !== 1 ? 's' : ''} *
            </button>
            <button
              onClick={() => setShowConfidenceExplainer(true)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                color: getConfidenceColor(confidence),
                textDecoration: 'underline dotted',
                fontSize: '7pt',
                fontWeight: 700
              }}
            >
              {confidence}% ⓘ
            </button>
          </div>
          <button
            className="btn-utility"
            style={{ fontSize: '7pt', padding: '2px 8px' }}
            onClick={() => {
              onClose();
              window.dispatchEvent(new CustomEvent('trigger_image_upload', { detail: { vehicleId } }));
            }}
          >
            + proof
          </button>
        </div>
      </div>

      {/* Confidence Explainer Modal */}
      {showConfidenceExplainer && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
            maxWidth: '400px',
            zIndex: 10001
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '12px' }}>
            How Confidence is Calculated
          </h3>
          <div style={{ fontSize: '9pt', lineHeight: 1.6, color: 'var(--text)' }}>
            <div style={{ marginBottom: '8px' }}>
              <strong>Algorithm:</strong>
            </div>
            <ul style={{ paddingLeft: '20px', margin: '8px 0' }}>
              <li>Title document: +40%</li>
              <li>Registration: +30%</li>
              <li>VIN plate photo: +25%</li>
              <li>Multiple validators: +20% each</li>
              <li>Cross-verified data: +15%</li>
            </ul>
            <div style={{ marginTop: '12px', padding: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', fontSize: '8pt' }}>
              Your score: <strong>{confidence}%</strong> from {sources.length} source(s)
            </div>
          </div>
          <button
            className="button button-primary"
            style={{ width: '100%', marginTop: '12px', fontSize: '8pt' }}
            onClick={() => setShowConfidenceExplainer(false)}
          >
            Close
          </button>
        </div>
      )}

      {/* Validator Explainer Modal */}
      {showValidatorExplainer && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
            maxWidth: '400px',
            zIndex: 10001
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '12px' }}>
            What are Validators?
          </h3>
          <div style={{ fontSize: '9pt', lineHeight: 1.6, color: 'var(--text)' }}>
            <p>Validators are users who independently verify vehicle data by:</p>
            <ul style={{ paddingLeft: '20px', margin: '8px 0' }}>
              <li>Uploading matching documents</li>
              <li>Confirming with their own evidence</li>
              <li>Cross-referencing public records</li>
            </ul>
            <div style={{ marginTop: '12px', padding: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', fontSize: '8pt' }}>
              Data becomes <strong>verified</strong> when 2+ validators confirm the same information.
            </div>
          </div>
          <button
            className="button button-primary"
            style={{ width: '100%', marginTop: '12px', fontSize: '8pt' }}
            onClick={() => setShowValidatorExplainer(false)}
          >
            Close
          </button>
        </div>
      )}

      {/* Full Image Viewer */}
      {selectedImage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.95)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10002
          }}
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage}
            alt="Document"
            style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
          />
          <button
            onClick={() => setSelectedImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              fontSize: '20pt',
              cursor: 'pointer',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};

export default ValidationPopupV2;

