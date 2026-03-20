import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface Citation {
  id: string;
  component_type: string;
  component_name: string | null;
  value_usd: number;
  value_type: string | null;
  submitted_by: string;
  submitter_role: string | null;
  submitter_name: string | null;
  submitted_at: string;
  effective_date: string | null;
  evidence_type: string;
  source_image_tag_id: string | null;
  source_document_id: string | null;
  source_image_id: string | null;
  shop_id: string | null;
  laborer_user_id: string | null;
  labor_category: string | null;
  mitchell_operation_code: string | null;
  confidence_score: number;
  verification_status: string;
  verified_by: string | null;
  verified_at: string | null;
  is_user_generated: boolean;
  replaced_system_value: boolean;
  notes: string | null;
  metadata: any;
}

interface CitationModalProps {
  vehicleId: string;
  componentType: string;
  componentName: string;
  valueUsd: number;
  onClose: () => void;
}

export default function CitationModal({
  vehicleId,
  componentType,
  componentName,
  valueUsd,
  onClose
}: CitationModalProps) {
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    loadCitations();
  }, [vehicleId, componentType, componentName]);

  const loadCitations = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('valuation_citations')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('component_type', componentType)
        .eq('component_name', componentName)
        .order('submitted_at', { ascending: false });

      if (error) throw error;
      setCitations(data || []);
    } catch (err) {
      console.error('Failed to load citations:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // TODO: Badge colors are used with hex-opacity suffix (e.g. `${color}22`), so they
  // cannot be CSS variables directly. Replace when a JS theme bridge is available.
  const getEvidenceBadge = (evidenceType: string) => {
    const badges: Record<string, { label: string; color: string }> = {
      receipt: { label: '🧾 Receipt', color: 'var(--success)' },
      invoice: { label: '📄 Invoice', color: 'var(--success)' },
      title: { label: '📋 Title', color: 'var(--info)' },
      image_tag: { label: '🏷️ Tag', color: '#8b5cf6' },
      market_listing: { label: '📊 Market', color: 'var(--warning)' },
      appraisal_doc: { label: '✓ Appraisal', color: 'var(--success)' },
      user_input: { label: '👤 User', color: 'var(--text-secondary)' },
      ai_extraction: { label: 'AI', color: '#ec4899' },
      system_calculation: { label: '⚙️ System', color: '#64748b' }
    };
    return badges[evidenceType] || { label: evidenceType, color: 'var(--text-disabled)' };
  };

  // TODO: Role badge colors are used with hex-opacity suffix, cannot be CSS variables.
  const getRoleBadge = (role: string | null) => {
    if (!role) return null;
    const colors: Record<string, string> = {
      owner: 'var(--success)',
      mechanic: 'var(--info)',
      appraiser: '#8b5cf6',
      uploader: 'var(--text-secondary)',
      ai: '#ec4899',
      system: '#64748b'
    };
    return { color: colors[role] || 'var(--text-disabled)' };
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10002,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          width: '720px',
          maxWidth: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          border: '2px solid var(--border)'}}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '2px solid var(--border)',
          background: 'var(--grey-100)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 'bold' }}>{componentName}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Value: ${valueUsd.toLocaleString()} · {citations.length} source{citations.length === 1 ? '' : 's'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="button button-small"
            style={{ fontSize: '11px', padding: '4px 8px' }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '16px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '12px' }}>
              Loading citations...
            </div>
          ) : citations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '12px' }}>
              No citation data available for this value.
              <div style={{ marginTop: '12px', fontSize: '11px' }}>
                This value may be AI-estimated or system-calculated without source attribution.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {citations.map((cit, idx) => {
                const evidenceBadge = getEvidenceBadge(cit.evidence_type);
                const roleBadge = getRoleBadge(cit.submitter_role);

                return (
                  <div
                    key={cit.id}
                    style={{
                      border: '1px solid var(--border)', padding: '12px',
                      background: idx === 0 ? 'var(--surface)' : 'var(--bg)'
                    }}
                  >
                    {/* Primary row: WHO, WHEN, VALUE */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600 }}>
                          {cit.submitter_name || 'Unknown'}
                          {cit.submitter_role && (
                            <span
                              style={{
                                marginLeft: '6px',
                                fontSize: '9px',
                                padding: '2px 6px',
                                background: roleBadge?.color ? `${roleBadge.color}22` : 'var(--bg-secondary)',
                                color: roleBadge?.color || 'var(--text-secondary)', fontWeight: 'normal'
                              }}
                            >
                              {cit.submitter_role}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Submitted: {formatDate(cit.submitted_at)}
                          {cit.effective_date && (
                            <> · Effective: {new Date(cit.effective_date).toLocaleDateString()}</>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '15px', fontWeight: 700 }}>
                          ${cit.value_usd.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                          {cit.value_type || 'price'}
                        </div>
                      </div>
                    </div>

                    {/* Evidence badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span
                        style={{
                          fontSize: '9px',
                          padding: '3px 8px',
                          background: `${evidenceBadge.color}22`,
                          color: evidenceBadge.color, fontWeight: 600
                        }}
                      >
                        {evidenceBadge.label}
                      </span>
                      <span
                        style={{
                          fontSize: '9px',
                          padding: '3px 8px',
                          background: cit.confidence_score >= 80 ? '#10b98122' : '#f59e0b22',
                          color: cit.confidence_score >= 80 ? 'var(--success)' : 'var(--warning)'}}
                      >
                        {cit.confidence_score}% confidence
                      </span>
                      <span
                        style={{
                          fontSize: '9px',
                          padding: '3px 8px',
                          background:
                            cit.verification_status === 'receipt_confirmed' ? '#10b98122' :
                            cit.verification_status === 'professional_verified' ? '#3b82f622' :
                            cit.verification_status === 'disputed' ? '#ef444422' :
                            'var(--bg-secondary)',
                          color:
                            cit.verification_status === 'receipt_confirmed' ? 'var(--success)' :
                            cit.verification_status === 'professional_verified' ? 'var(--info)' :
                            cit.verification_status === 'disputed' ? 'var(--error)' :
                            'var(--text-secondary)'}}
                      >
                        {cit.verification_status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {/* Evidence links */}
                    {(cit.source_document_id || cit.source_image_id || cit.source_image_tag_id) && (
                      <div style={{ fontSize: '11px', color: 'var(--text)', marginBottom: '8px' }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>Evidence:</div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {cit.source_document_id && (
                            <a
                              href={`#document-${cit.source_document_id}`}
                              style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                            >
                              View Receipt/Document
                            </a>
                          )}
                          {cit.source_image_id && (
                            <button
                              onClick={async () => {
                                const { data } = await supabase
                                  .from('vehicle_images')
                                  .select('large_url, image_url')
                                  .eq('id', cit.source_image_id)
                                  .single();
                                if (data) setSelectedImage(data.large_url || data.image_url);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent)',
                                textDecoration: 'underline',
                                cursor: 'pointer',
                                padding: 0,
                                fontSize: '11px'
                              }}
                            >
                              View Image
                            </button>
                          )}
                          {cit.source_image_tag_id && (
                            <a
                              href={`#tag-${cit.source_image_tag_id}`}
                              style={{ color: '#8b5cf6' /* TODO: add --purple token */, textDecoration: 'underline', cursor: 'pointer' }}
                            >
                              View Tag
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Labor details */}
                    {(cit.shop_id || cit.laborer_user_id || cit.mitchell_operation_code) && (
                      <div style={{ fontSize: '11px', background: 'var(--bg)', padding: '8px'}}>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>Labor Details:</div>
                        {cit.shop_id && <div>Shop: {cit.shop_id.slice(0, 8)}...</div>}
                        {cit.laborer_user_id && <div>Laborer: {cit.laborer_user_id.slice(0, 8)}...</div>}
                        {cit.labor_category && <div>Category: {cit.labor_category}</div>}
                        {cit.mitchell_operation_code && <div>Mitchell Code: {cit.mitchell_operation_code}</div>}
                      </div>
                    )}

                    {/* Notes */}
                    {cit.notes && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', fontStyle: 'italic' }}>
                        "{cit.notes}"
                      </div>
                    )}

                    {/* Verification */}
                    {cit.verified_by && cit.verified_at && (
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-light)' }}>
                        Verified by user {cit.verified_by.slice(0, 8)}... on {formatDate(cit.verified_at)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Image lightbox */}
        {selectedImage && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.9)',
              zIndex: 10003,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px'
            }}
            onClick={() => setSelectedImage(null)}
          >
            <img
              src={selectedImage}
              alt="Evidence"
              style={{ maxWidth: '100%', maxHeight: '100%', border: '2px solid var(--bg)' }}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setSelectedImage(null)}
              style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                background: 'var(--surface)',
                border: 'none',
                padding: '8px 12px',
                fontSize: '12px',
                cursor: 'pointer'}}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

