import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ui/Toast';

interface PendingExtraction {
  extraction_id: string;
  document_id: string;
  document_title: string;
  document_type: string;
  year: number;
  make: string;
  series: string | null;
  body_style: string | null;
  extracted_data: any;
  validation_questions: any;
  extracted_at: string;
  uploader_name: string | null;
}

const ExtractionReview: React.FC = () => {
  const { showToast } = useToast();
  const [extractions, setExtractions] = useState<PendingExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExtraction, setSelectedExtraction] = useState<PendingExtraction | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    loadPendingExtractions();
  }, []);

  const loadPendingExtractions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('pending_document_reviews')
        .select('*')
        .order('extracted_at', { ascending: false });

      if (error) throw error;
      setExtractions(data || []);
    } catch (error: any) {
      console.error('Failed to load extractions:', error);
      showToast('Failed to load pending extractions', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (extractionId: string) => {
    try {
      setReviewing(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Call the apply function
      const { data, error } = await supabase.rpc('apply_extraction_to_specs', {
        p_extraction_id: extractionId,
        p_user_id: user.id
      });

      if (error) throw error;

      showToast('Extraction applied successfully!', 'success');
      setSelectedExtraction(null);
      loadPendingExtractions();
    } catch (error: any) {
      console.error('Failed to apply extraction:', error);
      showToast(error.message || 'Failed to apply extraction', 'error');
    } finally {
      setReviewing(false);
    }
  };

  const handleReject = async (extractionId: string) => {
    try {
      setReviewing(true);
      
      const { error } = await supabase
        .from('document_extractions')
        .update({ status: 'rejected' })
        .eq('id', extractionId);

      if (error) throw error;

      showToast('Extraction rejected', 'info');
      setSelectedExtraction(null);
      loadPendingExtractions();
    } catch (error: any) {
      console.error('Failed to reject extraction:', error);
      showToast(error.message || 'Failed to reject extraction', 'error');
    } finally {
      setReviewing(false);
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '40px 20px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '10pt', color: 'var(--text-muted)' }}>Loading extractions...</div>
        </div>
      </div>
    );
  }

  if (extractions.length === 0) {
    return (
      <div className="container" style={{ padding: '40px 20px' }}>
        <h1 style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '12px' }}>
          Document Extraction Review
        </h1>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          padding: '40px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '10pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
            No pending extractions
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Upload reference documents to see AI-extracted data here for review
          </div>
        </div>
      </div>
    );
  }

  if (selectedExtraction) {
    return (
      <div className="container" style={{ padding: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <button
            onClick={() => setSelectedExtraction(null)}
            className="button button-secondary"
            style={{ fontSize: '8pt' }}
          >
            Back to List
          </button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          marginBottom: '16px'
        }}>
          {/* Document Info */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '16px'
          }}>
            <h2 style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '12px' }}>
              {selectedExtraction.document_title}
            </h2>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
              {selectedExtraction.year} {selectedExtraction.make} {selectedExtraction.series} {selectedExtraction.body_style}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              Uploaded by {selectedExtraction.uploader_name || 'Unknown'}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              {new Date(selectedExtraction.extracted_at).toLocaleString()}
            </div>
          </div>

          {/* Actions */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <button
              onClick={() => handleApprove(selectedExtraction.extraction_id)}
              disabled={reviewing}
              className="button button-primary"
              style={{ fontSize: '8pt', width: '100%' }}
            >
              {reviewing ? 'Applying...' : 'Approve & Apply to Database'}
            </button>
            <button
              onClick={() => handleReject(selectedExtraction.extraction_id)}
              disabled={reviewing}
              className="button button-secondary"
              style={{ fontSize: '8pt', width: '100%' }}
            >
              Reject Extraction
            </button>
          </div>
        </div>

        {/* Extracted Data Display */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          padding: '16px'
        }}>
          <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px' }}>
            Extracted Data
          </h3>

          {/* Specifications */}
          {selectedExtraction.extracted_data?.specifications && (
            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px' }}>Specifications</h4>
              
              {/* Dimensions */}
              {selectedExtraction.extracted_data.specifications.dimensions && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>Dimensions</div>
                  <pre style={{
                    fontSize: '7pt',
                    background: '#f5f5f5',
                    padding: '8px',
                    borderRadius: '4px',
                    overflow: 'auto'
                  }}>
                    {JSON.stringify(selectedExtraction.extracted_data.specifications.dimensions, null, 2)}
                  </pre>
                </div>
              )}

              {/* Engines */}
              {selectedExtraction.extracted_data.specifications.engines && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                    Engines ({selectedExtraction.extracted_data.specifications.engines.length} found)
                  </div>
                  <pre style={{
                    fontSize: '7pt',
                    background: '#f5f5f5',
                    padding: '8px',
                    borderRadius: '4px',
                    overflow: 'auto',
                    maxHeight: '200px'
                  }}>
                    {JSON.stringify(selectedExtraction.extracted_data.specifications.engines, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Colors */}
          {selectedExtraction.extracted_data?.colors && selectedExtraction.extracted_data.colors.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px' }}>
                Paint Colors ({selectedExtraction.extracted_data.colors.length} found)
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
                {selectedExtraction.extracted_data.colors.map((color: any, index: number) => (
                  <div key={index} style={{
                    background: '#f5f5f5',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '7pt'
                  }}>
                    <div style={{ fontWeight: 600 }}>{color.name}</div>
                    <div style={{ color: 'var(--text-muted)' }}>Code: {color.code}</div>
                    {color.color_family && (
                      <div style={{ color: 'var(--text-muted)' }}>Family: {color.color_family}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Options/RPO Codes */}
          {selectedExtraction.extracted_data?.options && selectedExtraction.extracted_data.options.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px' }}>
                Options ({selectedExtraction.extracted_data.options.length} found)
              </h4>
              <pre style={{
                fontSize: '7pt',
                background: '#f5f5f5',
                padding: '8px',
                borderRadius: '4px',
                overflow: 'auto',
                maxHeight: '200px'
              }}>
                {JSON.stringify(selectedExtraction.extracted_data.options, null, 2)}
              </pre>
            </div>
          )}

          {/* Trim Levels */}
          {selectedExtraction.extracted_data?.trim_levels && selectedExtraction.extracted_data.trim_levels.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px' }}>
                Trim Levels ({selectedExtraction.extracted_data.trim_levels.length} found)
              </h4>
              <pre style={{
                fontSize: '7pt',
                background: '#f5f5f5',
                padding: '8px',
                borderRadius: '4px',
                overflow: 'auto'
              }}>
                {JSON.stringify(selectedExtraction.extracted_data.trim_levels, null, 2)}
              </pre>
            </div>
          )}

          {/* Raw JSON (collapsible) */}
          <details style={{ marginTop: '16px' }}>
            <summary style={{ fontSize: '8pt', cursor: 'pointer', fontWeight: 600 }}>
              View Full JSON
            </summary>
            <pre style={{
              fontSize: '7pt',
              background: '#f5f5f5',
              padding: '8px',
              borderRadius: '4px',
              overflow: 'auto',
              maxHeight: '400px',
              marginTop: '8px'
            }}>
              {JSON.stringify(selectedExtraction.extracted_data, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1 style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '12px' }}>
        Document Extraction Review
      </h1>
      <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '20px' }}>
        Review AI-extracted data from reference documents before applying to the database
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {extractions.map((extraction) => (
          <div
            key={extraction.extraction_id}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '16px',
              cursor: 'pointer',
              transition: 'border-color 0.2s'
            }}
            onClick={() => setSelectedExtraction(extraction)}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                  {extraction.document_title}
                </h3>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  {extraction.year} {extraction.make} {extraction.series} {extraction.body_style}
                </div>
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                  Extracted {new Date(extraction.extracted_at).toLocaleDateString()}
                  {extraction.uploader_name && ` by ${extraction.uploader_name}`}
                </div>
              </div>
              <div style={{
                background: '#fef3c7',
                color: '#92400e',
                padding: '4px 8px',
                borderRadius: '12px',
                fontSize: '7pt',
                fontWeight: 600
              }}>
                Pending Review
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ExtractionReview;

