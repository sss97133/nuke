import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CollapsibleWidget } from '../ui/CollapsibleWidget';
import { useImageAnalysis } from '../../hooks/useImageAnalysis';

type FieldPriority = 'critical' | 'high' | 'medium' | 'low';

type DataGap = {
  id: string;
  field_name: string;
  field_priority: FieldPriority;
  gap_reason: string | null;
  points_reward: number | null;
  is_filled: boolean;
};

type ProofImage = {
  id: string;
  image_url: string;
  thumbnail_url?: string | null;
  medium_url?: string | null;
  created_at?: string | null;
  sensitive_type?: string | null;
  is_document?: boolean | null;
  document_category?: string | null;
  ai_processing_status?: string | null;
  ai_scan_metadata?: any;
};

function priorityLabel(priority: FieldPriority): string {
  return priority.toUpperCase();
}

function priorityBadgeClass(priority: FieldPriority): string {
  switch (priority) {
    case 'critical':
      return 'badge badge-danger';
    case 'high':
      return 'badge badge-warning';
    case 'medium':
      return 'badge badge-secondary';
    case 'low':
    default:
      return 'badge badge-secondary';
  }
}

function prettyFieldName(fieldName: string): string {
  return String(fieldName || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function VehicleDataGapsCard({
  vehicleId,
  limit = 8,
  canTriggerAnalysis = false,
  canAdminOverride = false,
}: {
  vehicleId: string;
  limit?: number;
  canTriggerAnalysis?: boolean;
  canAdminOverride?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [gaps, setGaps] = useState<DataGap[]>([]);
  const [openGap, setOpenGap] = useState<DataGap | null>(null);
  const [value, setValue] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [context, setContext] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<any | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [vehicleImages, setVehicleImages] = useState<ProofImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisValue, setAnalysisValue] = useState<string | null>(null);

  const { analyzeImage, analyzing: analysisRunning, analysisProgress } = useImageAnalysis();

  const sortedGaps = useMemo(() => {
    const order: Record<FieldPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...gaps].sort((a, b) => {
      const ap = order[a.field_priority] ?? 99;
      const bp = order[b.field_priority] ?? 99;
      if (ap !== bp) return ap - bp;
      const ar = a.points_reward ?? 0;
      const br = b.points_reward ?? 0;
      return br - ar;
    });
  }, [gaps]);

  const selectedImage = useMemo(
    () => vehicleImages.find((img) => img.id === selectedImageId) || null,
    [vehicleImages, selectedImageId]
  );

  const proofImages = useMemo(() => {
    const docCandidates = vehicleImages.filter(
      (img) => img.sensitive_type || img.is_document || img.document_category
    );
    const list = docCandidates.length > 0 ? docCandidates : vehicleImages;
    return list.slice(0, 24);
  }, [vehicleImages]);

  const extractValueFromAnalysis = (image: ProofImage, fieldName: string): string | null => {
    const meta = (image?.ai_scan_metadata || {}) as any;
    if (!meta || fieldName !== 'vin') return null;
    const candidates = [
      meta?.vin_tag?.vin,
      meta?.spid?.vin,
      meta?.spid?.extracted_data?.vin,
      meta?.spid_data?.extracted_data?.vin,
      meta?.appraiser?.extracted_data?.vin
    ];
    const vin = candidates.find((val) => typeof val === 'string' && val.trim().length >= 4);
    return vin ? String(vin).trim() : null;
  };

  const inferSourceType = (image: ProofImage | null): string | null => {
    if (!image) return null;
    const st = String(image.sensitive_type || '').toLowerCase();
    if (st === 'vin_plate') return 'vin_plate_photo';
    if (st === 'title') return 'title_document';
    if (st === 'registration') return 'registration_document';
    if (st === 'bill_of_sale') return 'bill_of_sale_document';
    if (image.is_document || image.document_category) return 'document_photo';
    return null;
  };

  const loadProofImages = async (): Promise<ProofImage[]> => {
    if (!vehicleId) return [];
    setImagesLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, medium_url, created_at, sensitive_type, is_document, document_category, ai_processing_status, ai_scan_metadata')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false })
        .limit(60);

      if (error) throw error;
      const next = (data as ProofImage[]) || [];
      setVehicleImages(next);
      return next;
    } catch (err) {
      console.error('Failed to load vehicle images for proof:', err);
      setVehicleImages([]);
      return [];
    } finally {
      setImagesLoading(false);
    }
  };

  const handleSelectImage = (image: ProofImage) => {
    setSelectedImageId(image.id);
    setEvidenceUrl(image.image_url || '');
    if (openGap) {
      const extracted = extractValueFromAnalysis(image, openGap.field_name);
      setAnalysisValue(extracted);
      if (extracted && !value.trim()) {
        setValue(extracted);
      }
    }
  };

  const runSelectedAnalysis = async () => {
    if (!selectedImage || !openGap) return;
    setAnalysisError(null);
    let userId: string | null = null;
    try {
      const { data: authData } = await supabase.auth.getUser();
      userId = authData?.user?.id ?? null;
    } catch {
      userId = null;
    }

    const result = await analyzeImage(selectedImage.image_url, undefined, vehicleId, {
      imageId: selectedImage.id,
      userId,
      forceReprocess: false
    });

    if (!result.success) {
      setAnalysisError(result.error || 'Analysis failed');
      return;
    }

    const refreshed = await loadProofImages();
    const updated = refreshed.find((img) => img.id === selectedImage.id) || selectedImage;
    const extracted = extractValueFromAnalysis(updated, openGap.field_name);
    setAnalysisValue(extracted);
    if (extracted && !value.trim()) {
      setValue(extracted);
    }
  };

  const loadGaps = async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('data_gaps')
        .select('id, field_name, field_priority, gap_reason, points_reward, is_filled')
        .eq('entity_type', 'vehicle')
        .eq('entity_id', vehicleId)
        .eq('is_filled', false)
        .limit(limit);

      if (error) throw error;
      setGaps((data as any[]) || []);
    } catch (err) {
      console.error('Failed to load vehicle data gaps:', err);
      setGaps([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, limit]);

  useEffect(() => {
    if (!openGap) return;
    setSelectedImageId(null);
    setAnalysisError(null);
    setAnalysisValue(null);
    loadProofImages();
  }, [openGap?.id, vehicleId]);

  const closeModal = () => {
    setOpenGap(null);
    setValue('');
    setEvidenceUrl('');
    setContext('');
    setSubmitting(false);
    setSubmitResult(null);
    setSelectedImageId(null);
    setAnalysisError(null);
    setAnalysisValue(null);
  };

  const submitEvidence = async () => {
    if (!openGap) return;
    const proposed = value.trim();
    const url = evidenceUrl.trim();
    const ctx = context.trim();
    if (!proposed) return;

    setSubmitting(true);
    setSubmitResult(null);

    try {
      const sourceType = inferSourceType(selectedImage);
      const { data, error } = await supabase.rpc('submit_data_gap_evidence', {
        p_gap_id: openGap.id,
        p_proposed_value: proposed,
        p_evidence_url: url || null,
        p_source_type: sourceType,
        p_context: ctx || null
      });

      if (error) throw error;
      setSubmitResult(data);
      await loadGaps();

      // If the gap is now filled, close. Otherwise keep open and explain it needs more proof/consensus.
      if (data?.gap_filled) {
        closeModal();
        setTimeout(() => window.location.reload(), 250);
      }
    } catch (err: any) {
      console.error('submit_data_gap_evidence failed:', err);
      alert(`Failed to submit proof: ${err?.message || String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const applyAdminOverride = async () => {
    if (!openGap) return;
    const proposed = value.trim();
    if (!proposed) return;

    const normalizedValue = (() => {
      if (['year', 'mileage', 'horsepower', 'doors', 'seats'].includes(openGap.field_name)) {
        const cleaned = proposed.replace(/[^\d]/g, '');
        return cleaned ? parseInt(cleaned, 10) : null;
      }
      if (openGap.field_name === 'vin') {
        const normalized = proposed.toUpperCase().replace(/[^A-Z0-9]/g, '');
        return normalized || null;
      }
      return proposed;
    })();

    setSubmitting(true);
    setSubmitResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-update-vehicle-field', {
        body: {
          vehicle_id: vehicleId,
          field_name: openGap.field_name,
          field_value: normalizedValue,
          source_url: evidenceUrl.trim() || null,
          source_image_id: selectedImageId || null,
          note: context.trim() || null
        }
      });

      if (error) throw error;
      if (!(data as any)?.ok) {
        throw new Error((data as any)?.error || 'Admin update failed');
      }

      setSubmitResult({ gap_filled: true, admin_applied: true });
      await loadGaps();
      closeModal();
      setTimeout(() => window.location.reload(), 250);
    } catch (err: any) {
      console.error('Admin apply failed:', err);
      alert(`Failed to apply admin update: ${err?.message || String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id="vehicle-proof-tasks">
      <CollapsibleWidget
        title="Proof Tasks"
        defaultCollapsed={true}
        badge={<span className="badge badge-secondary">{sortedGaps.length}</span>}
      >
        <div>
        {showWhy && (
          <div style={{ border: '1px solid var(--border-light)', borderRadius: 6, padding: 10, background: 'var(--grey-50)', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: '9pt', marginBottom: 4 }}>
              Why does this panel show up sometimes?
            </div>
            <div className="text-small text-muted" style={{ lineHeight: 1.4 }}>
              This is a <strong>proof/verification tool</strong>. Owners and “responsible parties” often see extra panels like this because they can submit evidence that updates the profile once confidence is high.
            </div>
          </div>
        )}
        <div className="text-small text-muted" style={{ marginBottom: '12px' }}>
          Missing or low-trust fields. Submit proof; the system only writes to the profile when confidence is high.
        </div>

        {loading ? (
          <div className="text-center text-muted">Loading proof tasks…</div>
        ) : sortedGaps.length === 0 ? (
          <div className="text-center">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>No open proof tasks</div>
            <div className="text-small text-muted">This profile has no active data gaps right now.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {sortedGaps.map((gap) => (
              <div
                key={gap.id}
                style={{
                  border: '1px solid var(--border-light)',
                  borderRadius: 6,
                  padding: '10px',
                  background: 'var(--white)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800 }}>{prettyFieldName(gap.field_name)}</div>
                      <span className={priorityBadgeClass(gap.field_priority)}>{priorityLabel(gap.field_priority)}</span>
                      {typeof gap.points_reward === 'number' && gap.points_reward > 0 && (
                        <span className="badge badge-success">+{gap.points_reward} pts</span>
                      )}
                    </div>
                    {gap.gap_reason && (
                      <div className="text-small text-muted" style={{ marginTop: 6 }}>
                        {gap.gap_reason}
                      </div>
                    )}
                  </div>

                  <button
                    className="button button-small button-primary"
                    onClick={() => setOpenGap(gap)}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Add proof
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </CollapsibleWidget>

      {openGap && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="modal-title">Add proof: {prettyFieldName(openGap.field_name)}</div>
                <div className="text-small text-muted">
                  Provide a value + a link to evidence (listing, doc, photo, archive). No “fake values” — proof is the asset.
                </div>
              </div>
              <button className="modal-close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-body">
              <div style={{ display: 'grid', gap: 10 }}>
                <label className="text-small" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Value</div>
                  <input
                    className="input"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={`Enter ${prettyFieldName(openGap.field_name)}`}
                    autoFocus
                  />
                </label>

                <label className="text-small" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Evidence URL (recommended)</div>
                  <input
                    className="input"
                    value={evidenceUrl}
                    onChange={(e) => setEvidenceUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </label>

                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Use existing photos</div>
                  <div className="text-small text-muted">
                    Pick a VIN plate/title/registration photo from this vehicle, then optionally run analysis.
                  </div>
                  {imagesLoading ? (
                    <div className="text-small text-muted">Loading images…</div>
                  ) : proofImages.length === 0 ? (
                    <div className="text-small text-muted">
                      No images found yet. Upload a proof photo to enable AI analysis.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
                      {proofImages.map((img) => {
                        const thumb = img.thumbnail_url || img.medium_url || img.image_url;
                        const isSelected = selectedImageId === img.id;
                        return (
                          <button
                            key={img.id}
                            type="button"
                            onClick={() => handleSelectImage(img)}
                            style={{
                              border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-light)',
                              padding: 0,
                              background: 'var(--white)',
                              cursor: 'pointer'
                            }}
                            title={img.sensitive_type || 'image'}
                          >
                            <div style={{ position: 'relative', width: '100%', paddingBottom: '70%', overflow: 'hidden' }}>
                              <img
                                src={thumb}
                                alt="Proof candidate"
                                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            </div>
                            <div style={{ fontSize: '7pt', padding: '4px 6px', textAlign: 'left' }}>
                              <div style={{ fontWeight: 700 }}>
                                {img.sensitive_type ? img.sensitive_type.replace(/_/g, ' ') : 'photo'}
                              </div>
                              {img.ai_processing_status && (
                                <div style={{ color: 'var(--text-muted)' }}>{img.ai_processing_status}</div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('trigger_image_upload', { detail: { vehicleId } }));
                      }}
                    >
                      Upload proof
                    </button>
                    {canTriggerAnalysis && selectedImage && (
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={runSelectedAnalysis}
                        disabled={analysisRunning}
                      >
                        {analysisRunning ? 'Analyzing…' : 'Analyze selected'}
                      </button>
                    )}
                  </div>
                  {analysisRunning && analysisProgress && (
                    <div className="text-small text-muted">{analysisProgress}</div>
                  )}
                  {analysisError && (
                    <div className="text-small" style={{ color: 'var(--danger)' }}>{analysisError}</div>
                  )}
                  {analysisValue && (
                    <div className="text-small" style={{ color: 'var(--success)' }}>
                      Extracted from analysis: <strong>{analysisValue}</strong>
                    </div>
                  )}
                </div>

                <label className="text-small" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Context (optional)</div>
                  <textarea
                    className="input"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="Where in the source is it stated? Any notes for reviewers?"
                    rows={3}
                  />
                </label>

                {submitResult && (
                  <div style={{ border: '1px solid var(--border-light)', padding: 10, borderRadius: 6, background: 'var(--surface)' }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>
                      {submitResult?.gap_filled ? 'Applied to profile' : 'Submitted for consensus'}
                    </div>
                    <div className="text-small text-muted">
                      {submitResult?.gap_filled
                        ? `Confidence met threshold; gap closed${submitResult?.points_awarded ? ` (+${submitResult.points_awarded} pts)` : ''}.`
                        : 'Evidence saved. The gap stays open until confidence is high enough (or an expert verifies).'}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', gap: 8 }}>
              <button className="button button-secondary" onClick={closeModal} disabled={submitting}>
                Cancel
              </button>
              {canAdminOverride && (
                <button
                  className="button button-secondary"
                  onClick={applyAdminOverride}
                  disabled={submitting || !value.trim()}
                  style={{ marginLeft: 'auto' }}
                >
                  Apply now (admin)
                </button>
              )}
              <button
                className="button button-primary"
                onClick={submitEvidence}
                disabled={submitting || !value.trim()}
                style={{ marginLeft: canAdminOverride ? undefined : 'auto' }}
              >
                {submitting ? 'Submitting…' : 'Submit proof'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

