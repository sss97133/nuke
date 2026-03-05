import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useVINProofs } from '../../hooks/useVINProofs';
import { useFieldIntelligence, type FieldIntelligence } from '../../hooks/useFieldIntelligence';

interface ValidationSource {
  source_type: string;
  document_type?: string;
  document_state?: string;
  confidence_score: number;
  image_url?: string;
  created_at: string;
  verified_by?: string;
  source_name?: string;
  source_url?: string;
  logo_url?: string;
}

interface ValidationPopupV2Props {
  vehicleId: string;
  fieldName: string;
  fieldValue: string;
  vehicleYear?: number;
  vehicleMake?: string;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fmt = (n: number | null | undefined): string => {
  if (n == null) return '--';
  return n.toLocaleString('en-US');
};

const fmtPrice = (n: number | null | undefined): string => {
  if (n == null) return '--';
  return '$' + Math.round(n).toLocaleString('en-US');
};

const fmtPct = (n: number | null | undefined): string => {
  if (n == null) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}%`;
};

const getConfidenceColor = (score: number) => {
  if (score >= 90) return 'var(--success)';
  if (score >= 75) return 'var(--text)';
  if (score >= 60) return 'var(--warning)';
  return 'var(--error)';
};

const getSourceLabel = (source: ValidationSource) => {
  const type = source.document_type || 'document';
  const state = source.document_state;

  if (source.source_type === 'bat_auction') return source.source_name || 'BRING A TRAILER';
  if (source.source_type === 'dealer_listing') return source.source_name || 'DEALER LISTING';
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

const getRarityColor = (rarity: string) => {
  switch (rarity) {
    case 'UNIQUE': return 'var(--error)';
    case 'RARE': return 'var(--warning)';
    case 'UNCOMMON': return 'var(--text)';
    default: return 'var(--text-secondary)';
  }
};

/* ------------------------------------------------------------------ */
/*  Inline styles — Nuke design system compliant                       */
/* ------------------------------------------------------------------ */

const S = {
  overlay: {
    position: 'fixed' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000,
  },
  panel: {
    width: '90%',
    maxWidth: '520px',
    maxHeight: '85vh',
    background: 'var(--surface)',
    border: '2px solid var(--border)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    padding: '8px 12px',
    borderBottom: '2px solid var(--border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'var(--bg)',
  },
  label: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary)',
  },
  value: {
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--text)',
  },
  sectionLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary)',
    marginBottom: '6px',
  },
  statBox: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '4px',
  },
  statValue: {
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--text)',
  },
  statUnit: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  footer: {
    padding: '8px 12px',
    borderTop: '2px solid var(--border)',
    background: 'var(--bg)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '9px',
    fontFamily: 'Arial, sans-serif',
  },
};

/* ------------------------------------------------------------------ */
/*  Intelligence Section                                               */
/* ------------------------------------------------------------------ */

const IntelligenceSection: React.FC<{
  intel: FieldIntelligence;
  fieldName: string;
  fieldValue: string;
}> = ({ intel, fieldName, fieldValue }) => {
  const hasPriceData = intel.avg_price_with != null && intel.price_sample_count != null && intel.price_sample_count > 2;
  const hasTemporalData = intel.min_year != null && intel.max_year != null;

  return (
    <div style={{ padding: '12px', borderBottom: '2px solid var(--border)', background: 'var(--bg)' }}>
      <div style={S.sectionLabel}>FIELD INTELLIGENCE</div>

      {/* Row 1: Count + Rank + Rarity */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <div style={S.statBox}>
          <span style={S.statValue}>{fmt(intel.exact_match_count)}</span>
          <span style={S.statUnit}>OF {fmt(intel.total_with_field)} VEHICLES</span>
        </div>
        <div style={S.statBox}>
          <span style={S.statUnit}>RANK</span>
          <span style={S.statValue}>#{fmt(intel.rank)}</span>
          <span style={S.statUnit}>OF {fmt(intel.total_distinct_values)}</span>
        </div>
        <div style={{
          ...S.statBox,
          padding: '1px 6px',
          border: '2px solid var(--border)',
          background: 'var(--surface)',
        }}>
          <span style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '8px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: getRarityColor(intel.rarity),
          }}>
            {intel.rarity}
          </span>
        </div>
      </div>

      {/* Row 2: Price Impact */}
      {hasPriceData && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ ...S.sectionLabel, marginBottom: '2px' }}>PRICE IMPACT</div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={S.statBox}>
              <span style={S.statValue}>{fmtPrice(intel.avg_price_with)}</span>
              <span style={S.statUnit}>AVG</span>
            </div>
            <div style={S.statBox}>
              <span style={S.statValue}>{fmtPrice(intel.median_price_with)}</span>
              <span style={S.statUnit}>MED</span>
            </div>
            {intel.price_premium_pct != null && (
              <div style={S.statBox}>
                <span style={{
                  ...S.statValue,
                  color: intel.price_premium_pct > 0 ? 'var(--success)' : intel.price_premium_pct < -10 ? 'var(--error)' : 'var(--text)',
                }}>
                  {fmtPct(intel.price_premium_pct)}
                </span>
                <span style={S.statUnit}>VS OTHERS</span>
              </div>
            )}
            <div style={S.statBox}>
              <span style={{ ...S.statUnit, color: 'var(--text-disabled)' }}>
                ({fmt(intel.price_sample_count)} PRICED)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Row 3: Temporal */}
      {hasTemporalData && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '10px' }}>
          <div style={S.statBox}>
            <span style={S.statUnit}>YEAR RANGE</span>
            <span style={S.statValue}>{intel.min_year}–{intel.max_year}</span>
          </div>
          {intel.peak_year && (
            <div style={S.statBox}>
              <span style={S.statUnit}>PEAK</span>
              <span style={S.statValue}>{intel.peak_year}</span>
            </div>
          )}
        </div>
      )}

      {/* Row 4: Top Values */}
      {intel.top_values && intel.top_values.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ ...S.sectionLabel, marginBottom: '4px' }}>
            TOP {fieldName.toUpperCase().replace(/_/g, ' ')} VALUES
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {intel.top_values.map((tv, i) => {
              const isCurrentValue = tv.value.toLowerCase().trim() === fieldValue.toLowerCase().trim();
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '2px 4px',
                    background: isCurrentValue ? 'var(--accent-dim)' : 'transparent',
                    borderLeft: isCurrentValue ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  <span style={{
                    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                    fontSize: '9px',
                    color: isCurrentValue ? 'var(--text)' : 'var(--text-secondary)',
                    fontWeight: isCurrentValue ? 700 : 400,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap' as const,
                  }}>
                    {tv.value}
                  </span>
                  <span style={{
                    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                    fontSize: '9px',
                    fontWeight: 700,
                    color: isCurrentValue ? 'var(--text)' : 'var(--text-disabled)',
                    minWidth: '40px',
                    textAlign: 'right' as const,
                  }}>
                    {fmt(tv.count)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Row 5: Companions */}
      {intel.companions && intel.companions.length > 0 && (
        <div>
          <div style={S.sectionLabel}>COMMON COMPANIONS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {intel.companions.map((comp, i) => (
              comp.values.length > 0 && (
                <div key={i} style={{ display: 'flex', gap: '4px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{
                    fontFamily: 'Arial, sans-serif',
                    fontSize: '8px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    letterSpacing: '0.05em',
                    minWidth: '60px',
                  }}>
                    {comp.label}:
                  </span>
                  <span style={{
                    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                    fontSize: '9px',
                    color: 'var(--text)',
                  }}>
                    {comp.values.slice(0, 4).map((v, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <span style={{ color: 'var(--text-disabled)', margin: '0 3px' }}>/</span>}
                        {v.value} <span style={{ color: 'var(--text-disabled)' }}>({v.count})</span>
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

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
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState(fieldValue);
  const [saving, setSaving] = useState(false);
  const [fieldAttribution, setFieldAttribution] = useState<any | null>(null);
  const [showConfidenceDetail, setShowConfidenceDetail] = useState(false);

  const isVinField = String(fieldName || '').toLowerCase() === 'vin';
  const { summary: vinProofSummary, loading: vinProofLoading } = useVINProofs(isVinField ? vehicleId : undefined);

  // Field intelligence — living aggregate data
  const { data: intelligence, isLoading: intelLoading } = useFieldIntelligence(fieldName, fieldValue);

  useEffect(() => {
    loadValidations();
  }, [vehicleId, fieldName]);

  const normalizeEditedValue = () => {
    const raw = String(editedValue ?? '').trim();
    if (!raw) return null;
    if (fieldName === 'vin') {
      const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return normalized || null;
    }
    if (['year', 'mileage', 'horsepower', 'doors', 'seats'].includes(fieldName)) {
      const cleaned = raw.replace(/[^\d]/g, '');
      return cleaned ? parseInt(cleaned, 10) : null;
    }
    return raw;
  };

  const loadValidations = async () => {
    try {
      setLoading(true);
      const allSources: ValidationSource[] = [];

      // Field attribution
      try {
        const { data: attrRow, error: attrErr } = await supabase
          .from('vehicle_field_sources')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('field_name', fieldName)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!attrErr) setFieldAttribution(attrRow || null);
      } catch {
        setFieldAttribution(null);
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
        .select('sensitive_type, image_url, created_at, user_id, documented_by_user_id, exif_data')
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
            verified_by: img.documented_by_user_id || img.user_id
          });
        });
      }

      // 3. BaT auction data
      const { data: batListing } = await supabase
        .from('bat_listings')
        .select('id, listing_url, sale_price, sale_date, vin, created_at')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();

      if (batListing) {
        allSources.push({
          source_type: 'bat_auction',
          document_type: 'auction_listing',
          confidence_score: 90,
          created_at: batListing.created_at || batListing.sale_date || new Date().toISOString(),
          source_name: 'Bring a Trailer',
          source_url: batListing.listing_url,
          logo_url: '/vendor/bat/favicon.ico',
          verified_by: 'BaT'
        });
      }

      // 4. Organization/dealer data
      const { data: orgVehicle } = await supabase
        .from('organization_vehicles')
        .select('id, organization_id, notes, created_at, businesses:organization_id(name, logo_url, website_url)')
        .eq('vehicle_id', vehicleId)
        .limit(1)
        .maybeSingle();

      if (orgVehicle && orgVehicle.businesses) {
        const biz = orgVehicle.businesses as any;
        allSources.push({
          source_type: 'dealer_listing',
          document_type: 'dealer_inventory',
          confidence_score: 85,
          created_at: orgVehicle.created_at || new Date().toISOString(),
          source_name: biz.name || 'Dealer',
          source_url: biz.website_url,
          logo_url: biz.logo_url,
          verified_by: biz.name
        });
      }

      // 5. Vehicle origin check
      const { data: vehicleOrigin } = await supabase
        .from('vehicles')
        .select('origin_organization_id, bat_auction_url, businesses:origin_organization_id(name, logo_url, website_url)')
        .eq('id', vehicleId)
        .maybeSingle();

      if (vehicleOrigin?.bat_auction_url && !batListing) {
        allSources.push({
          source_type: 'bat_auction',
          document_type: 'auction_listing',
          confidence_score: 85,
          created_at: new Date().toISOString(),
          source_name: 'Bring a Trailer',
          source_url: vehicleOrigin.bat_auction_url,
          logo_url: '/vendor/bat/favicon.ico',
          verified_by: 'BaT'
        });
      }

      if (vehicleOrigin?.origin_organization_id && vehicleOrigin.businesses && !orgVehicle) {
        const biz = vehicleOrigin.businesses as any;
        allSources.push({
          source_type: 'dealer_listing',
          document_type: 'dealer_inventory',
          confidence_score: 85,
          created_at: new Date().toISOString(),
          source_name: biz.name || 'Dealer',
          source_url: biz.website_url,
          logo_url: biz.logo_url,
          verified_by: biz.name
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
      const normalizedValue = normalizeEditedValue();
      updates[fieldName] = normalizedValue;

      const { error } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicleId);

      if (error) {
        const adminResult = await supabase.functions.invoke('admin-update-vehicle-field', {
          body: { vehicle_id: vehicleId, field_name: fieldName, field_value: normalizedValue }
        });
        if (adminResult.error) throw adminResult.error;
        if (!(adminResult.data as any)?.ok) {
          throw new Error((adminResult.data as any)?.error || 'Admin update failed');
        }
      }

      setSaving(false);
      window.location.reload();
    } catch (err) {
      console.error('Save failed:', err);
      setSaving(false);
      alert('Failed to save: ' + (err as any).message);
    }
  };

  const confidence = sources.length === 0 ? 50 : Math.round(sources.reduce((sum, s) => sum + s.confidence_score, 0) / sources.length);
  const uniqueValidators = new Set(sources.map(s => s.verified_by || s.source_name).filter(Boolean)).size;

  const attribution = (() => {
    if (!fieldAttribution) return null;
    const sourceType = String(fieldAttribution.source_type || 'unknown');
    const sourceUrl = typeof fieldAttribution.source_url === 'string' ? fieldAttribution.source_url : null;
    const who = fieldAttribution.source_user_id || fieldAttribution.user_id || fieldAttribution.updated_by || null;
    const when = fieldAttribution.entered_at || fieldAttribution.updated_at || null;
    const storedValue = typeof fieldAttribution.field_value === 'string' ? fieldAttribution.field_value : null;
    return { sourceType, sourceUrl, who, when, storedValue };
  })();

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <span style={S.label}>{fieldName.toUpperCase().replace(/_/g, ' ')}</span>
            {isEditing ? (
              <input
                type={['year', 'mileage', 'horsepower', 'doors', 'seats'].includes(fieldName) ? 'number' : 'text'}
                value={editedValue}
                onChange={(e) => setEditedValue(e.target.value)}
                autoFocus
                style={{
                  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '4px 8px',
                  border: '2px solid var(--accent)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  width: '200px',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
            ) : (
              <span style={S.value}>{fieldValue}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="button button-primary"
                  style={{ fontSize: '9px', padding: '4px 12px' }}
                >
                  {saving ? 'SAVING...' : 'SAVE'}
                </button>
                <button
                  onClick={() => { setEditedValue(fieldValue); setIsEditing(false); }}
                  className="button"
                  style={{ fontSize: '9px', padding: '4px 12px' }}
                >
                  CANCEL
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="button"
                style={{ fontSize: '9px', padding: '4px 12px' }}
              >
                EDIT
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '18px',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                color: 'var(--text-secondary)',
                fontFamily: 'Arial, sans-serif',
              }}
            >
              x
            </button>
          </div>
        </div>

        {/* ── VIN Provenance (VIN fields only) ── */}
        {isVinField && (
          <div style={{
            padding: '6px 12px',
            borderBottom: '2px solid var(--border)',
            background: 'var(--surface)',
            fontSize: '9px',
            fontFamily: 'Arial, sans-serif',
            color: 'var(--text-secondary)',
            lineHeight: 1.4,
          }}>
            <div>
              <strong>VIN ORIGIN:</strong>{' '}
              {attribution ? (
                <>
                  {attribution.sourceType}
                  {attribution.when ? ` / ${new Date(attribution.when).toLocaleString()}` : ''}
                  {attribution.sourceUrl ? (
                    <> / <a href={attribution.sourceUrl} target="_blank" rel="noreferrer"
                      style={{ color: 'var(--text)', textDecoration: 'underline' }}>source</a></>
                  ) : null}
                  {attribution.storedValue && attribution.storedValue !== fieldValue ? ' / STORED VALUE DIFFERS' : null}
                </>
              ) : 'No citation found'}
            </div>
            <div>
              <strong>EVIDENCE-BACKED PROOFS:</strong>{' '}
              {vinProofLoading ? 'Loading...' : vinProofSummary?.hasConclusiveProof ? (
                <>{vinProofSummary.conclusiveProofCount} conclusive / {vinProofSummary.totalConfidence}%</>
              ) : 'None yet'}
            </div>
          </div>
        )}

        {/* ── Scrollable Body ── */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* ── Intelligence Section (non-VIN fields) ── */}
          {!isVinField && intelligence && !intelligence.error && (
            <IntelligenceSection intel={intelligence} fieldName={fieldName} fieldValue={fieldValue} />
          )}
          {!isVinField && intelLoading && (
            <div style={{
              padding: '12px', borderBottom: '2px solid var(--border)',
              background: 'var(--bg)', textAlign: 'center',
            }}>
              <span style={{ ...S.label, color: 'var(--text-disabled)' }}>LOADING INTELLIGENCE...</span>
            </div>
          )}

          {/* ── Evidence Section ── */}
          <div style={{ padding: '12px' }}>
            <div style={S.sectionLabel}>
              EVIDENCE{!loading && ` / ${sources.length} SOURCE${sources.length !== 1 ? 'S' : ''}`}
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <span style={{ ...S.label, color: 'var(--text-disabled)' }}>LOADING...</span>
              </div>
            ) : sources.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <div style={{ ...S.label, color: 'var(--text-disabled)', marginBottom: '8px' }}>
                  {isVinField
                    ? 'NO PROOF ARTIFACTS YET (TITLE / REGISTRATION / VIN PLATE)'
                    : 'NO EVIDENCE YET'}
                </div>
                <button
                  className="button button-primary"
                  style={{ fontSize: '9px', padding: '4px 12px' }}
                  onClick={() => {
                    onClose();
                    window.dispatchEvent(new CustomEvent('trigger_image_upload', { detail: { vehicleId } }));
                  }}
                >
                  UPLOAD PROOF
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Validator badges */}
                {sources.filter(s => s.logo_url || s.source_name).length > 0 && (
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: '6px',
                    padding: '8px', background: 'var(--bg)', border: '2px solid var(--border)',
                  }}>
                    <div style={S.sectionLabel}>VERIFIED BY</div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {sources.filter(s => s.logo_url || s.source_name).map((source, idx) => (
                        <a
                          key={idx}
                          href={source.source_url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => !source.source_url && e.preventDefault()}
                          style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            gap: '3px', textDecoration: 'none',
                            cursor: source.source_url ? 'pointer' : 'default',
                          }}
                          title={source.source_url ? `View on ${source.source_name}` : source.source_name || ''}
                        >
                          {/* Square badge — no border-radius, no box-shadow */}
                          <div style={{
                            width: '36px', height: '36px',
                            background: 'var(--surface)',
                            border: `2px solid ${getConfidenceColor(source.confidence_score)}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            overflow: 'hidden',
                          }}>
                            {source.logo_url ? (
                              <img
                                src={source.logo_url}
                                alt={source.source_name || ''}
                                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  (e.target as HTMLImageElement).parentElement!.innerHTML =
                                    `<span style="font-size:12px;font-weight:700;font-family:Arial,sans-serif">${(source.source_name || 'V')[0]}</span>`;
                                }}
                              />
                            ) : (
                              <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'Arial, sans-serif', color: 'var(--text)' }}>
                                {(source.source_name || 'V')[0]}
                              </span>
                            )}
                          </div>
                          <span style={{
                            fontFamily: 'Arial, sans-serif', fontSize: '8px',
                            color: 'var(--text-secondary)', textAlign: 'center',
                            maxWidth: '56px', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {source.source_name || getSourceLabel(source)}
                          </span>
                          <span style={{
                            fontFamily: 'Arial, sans-serif', fontSize: '8px',
                            color: getConfidenceColor(source.confidence_score), fontWeight: 700,
                          }}>
                            {source.confidence_score}%
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Source cards */}
                {sources.map((source, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: '2px solid var(--border)',
                      overflow: 'hidden',
                      cursor: source.image_url ? 'pointer' : 'default',
                    }}
                    onClick={() => { if (source.image_url) setSelectedImage(source.image_url); }}
                  >
                    {/* Document image */}
                    {source.image_url && (
                      <div style={{ position: 'relative', height: '160px', overflow: 'hidden', background: 'var(--bg)' }}>
                        <img
                          src={source.image_url}
                          alt="Proof document"
                          style={{
                            width: '100%', height: '100%', objectFit: 'contain',
                            filter: 'blur(6px)', opacity: 0.8,
                          }}
                        />
                        <div style={{
                          position: 'absolute', top: '8px', left: '8px',
                          background: 'rgba(0,0,0,0.75)', padding: '3px 6px',
                          fontFamily: 'Arial, sans-serif', fontSize: '8px',
                          fontWeight: 700, color: '#fff', letterSpacing: '0.05em',
                        }}>
                          {getSourceLabel(source)}
                        </div>
                        <div style={{
                          position: 'absolute', bottom: '8px', right: '8px',
                          background: 'rgba(0,0,0,0.75)', padding: '3px 6px',
                          fontFamily: 'Arial, sans-serif', fontSize: '8px',
                          fontWeight: 700, color: getConfidenceColor(source.confidence_score),
                        }}>
                          {source.confidence_score}%
                        </div>
                        <div style={{
                          position: 'absolute', bottom: '8px', left: '8px',
                          fontFamily: 'Arial, sans-serif', fontSize: '8px',
                          color: 'rgba(255,255,255,0.6)',
                        }}>
                          {new Date(source.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    )}

                    {/* No image fallback */}
                    {!source.image_url && (
                      <div style={{ padding: '10px', fontSize: '10px', fontFamily: 'Arial, sans-serif' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          {source.logo_url && (
                            <img
                              src={source.logo_url}
                              alt={source.source_name || ''}
                              style={{ width: '18px', height: '18px', objectFit: 'contain' }}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <span style={{ fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {getSourceLabel(source)}
                          </span>
                          {source.source_url && (
                            <a
                              href={source.source_url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: '8px', color: 'var(--text)', textDecoration: 'underline',
                                marginLeft: 'auto', fontWeight: 700, letterSpacing: '0.05em',
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              VIEW SOURCE
                            </a>
                          )}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', fontSize: '8px' }}>
                          <span>{new Date(source.created_at).toLocaleDateString()}</span>
                          <span style={{ color: getConfidenceColor(source.confidence_score), fontWeight: 700 }}>
                            {source.confidence_score}%
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={S.footer}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span>{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
            <span style={{ color: 'var(--text-disabled)' }}>
              {uniqueValidators} validator{uniqueValidators !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setShowConfidenceDetail(!showConfidenceDetail)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                color: getConfidenceColor(confidence),
                textDecoration: 'underline dotted',
                fontSize: '9px', fontWeight: 700, fontFamily: 'Arial, sans-serif',
              }}
            >
              {confidence}%
            </button>
          </div>
          <button
            className="btn-utility"
            style={{ fontSize: '8px', padding: '2px 8px', fontFamily: 'Arial, sans-serif', letterSpacing: '0.05em' }}
            onClick={() => {
              onClose();
              window.dispatchEvent(new CustomEvent('trigger_image_upload', { detail: { vehicleId } }));
            }}
          >
            + PROOF
          </button>
        </div>

        {/* ── Confidence Detail (inline expand, replaces modal) ── */}
        {showConfidenceDetail && (
          <div style={{
            padding: '10px 12px',
            borderTop: '2px solid var(--border)',
            background: 'var(--surface)',
            fontFamily: 'Arial, sans-serif',
            fontSize: '9px',
            color: 'var(--text)',
            lineHeight: 1.5,
          }}>
            <div style={{ ...S.sectionLabel, marginBottom: '4px' }}>CONFIDENCE CALCULATION</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '8px' }}>
              <span>TITLE DOCUMENT: +40% / REGISTRATION: +30% / VIN PLATE: +25%</span>
              <span>MULTIPLE VALIDATORS: +20% EACH / CROSS-VERIFIED: +15%</span>
              <span style={{ marginTop: '4px', fontWeight: 700 }}>
                CURRENT: {confidence}% FROM {sources.length} SOURCE{sources.length !== 1 ? 'S' : ''}
              </span>
            </div>
            {uniqueValidators > 0 && (
              <div style={{ marginTop: '6px' }}>
                <span style={{ fontWeight: 700 }}>VALIDATORS: </span>
                {Array.from(new Set(sources.map(s => s.verified_by || s.source_name).filter(Boolean))).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Image Viewer ── */}
      {selectedImage && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.95)',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 10002,
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
              position: 'absolute', top: '20px', right: '20px',
              background: 'var(--surface)', border: '2px solid var(--border)',
              width: '36px', height: '36px',
              fontSize: '18px', cursor: 'pointer', lineHeight: 1,
              fontFamily: 'Arial, sans-serif', color: 'var(--text)',
            }}
          >
            x
          </button>
        </div>
      )}
    </div>
  );
};

export default ValidationPopupV2;
