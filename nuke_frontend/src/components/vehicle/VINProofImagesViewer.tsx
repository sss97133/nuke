/**
 * VINProofImagesViewer.tsx
 *
 * Lightweight modal that shows VIN and title/registration proof images only.
 * - VIN plate images: always shown.
 * - Title/registration: only after multi-step user verification (gated).
 * Replaces the outdated "insertion point" / upload UI when clicking the VIN proof bubble.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface VINProofImagesViewerProps {
  vehicleId: string;
  /** Whether the current user has passed verification to view title/registration docs */
  canViewTitleDocs?: boolean;
  onClose: () => void;
}

type DocType = 'vin_plate' | 'title' | 'registration' | 'bill_of_sale';

interface ProofImage {
  id: string;
  image_url: string;
  sensitive_type: string;
  created_at: string;
}

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
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: 'var(--text)',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px',
  },
  sectionLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary)',
    marginBottom: '8px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '8px',
  },
  imgWrap: {
    border: '2px solid var(--border)',
    overflow: 'hidden',
    background: 'var(--bg)',
    aspectRatio: '4/3',
  },
  img: {
    width: '100%',
    height: '100%',
    objectFit: 'contain' as const,
  },
  gateCard: {
    border: '2px solid var(--border)',
    padding: '16px',
    textAlign: 'center' as const,
    background: 'var(--bg)',
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    color: 'var(--text-secondary)',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 8px',
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    color: 'var(--text)',
    textDecoration: 'underline',
  },
};

function getDocLabel(t: string): string {
  const map: Record<string, string> = {
    vin_plate: 'VIN plate',
    title: 'Title',
    registration: 'Registration',
    bill_of_sale: 'Bill of sale',
  };
  return map[t] || t.replace(/_/g, ' ');
}

export const VINProofImagesViewer: React.FC<VINProofImagesViewerProps> = ({
  vehicleId,
  canViewTitleDocs = false,
  onClose,
}) => {
  const [vinImages, setVinImages] = useState<ProofImage[]>([]);
  const [titleImages, setTitleImages] = useState<ProofImage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vehicleId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('vehicle_images')
          .select('id, image_url, sensitive_type, created_at')
          .eq('vehicle_id', vehicleId)
          .in('sensitive_type', ['vin_plate', 'title', 'registration', 'bill_of_sale'])
          .order('created_at', { ascending: false });

        if (cancelled) return;
        if (error) {
          setVinImages([]);
          setTitleImages([]);
          setLoading(false);
          return;
        }

        const list = (data || []).filter((r: any) => r?.image_url) as ProofImage[];
        const vin = list.filter((r) => r.sensitive_type === 'vin_plate');
        const title = list.filter((r) =>
          ['title', 'registration', 'bill_of_sale'].includes(r.sensitive_type)
        );
        setVinImages(vin);
        setTitleImages(title);
      } catch {
        if (!cancelled) {
          setVinImages([]);
          setTitleImages([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [vehicleId]);

  return (
    <div style={S.overlay} onClick={onClose} role="dialog" aria-label="VIN and proof documents">
      <div
        style={S.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={S.header}>
          <span>VIN & proof documents</span>
          <button type="button" style={S.closeBtn} onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        <div style={S.body}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)', fontSize: '10px' }}>
              Loading…
            </div>
          ) : (
            <>
              {/* VIN plate images — always visible */}
              <div style={S.sectionLabel}>VIN plate</div>
              {vinImages.length === 0 ? (
                <div style={S.gateCard}>No VIN plate photos yet.</div>
              ) : (
                <div style={S.grid}>
                  {vinImages.map((img) => (
                    <div key={img.id} style={S.imgWrap}>
                      <img
                        src={img.image_url}
                        alt={getDocLabel(img.sensitive_type)}
                        style={S.img}
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Title / registration — gated by verification */}
              <div style={{ ...S.sectionLabel, marginTop: '16px' }}>Title / registration</div>
              {!canViewTitleDocs ? (
                <div style={S.gateCard}>
                  <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text)' }}>
                    Verification required
                  </p>
                  <p style={{ margin: 0 }}>
                    Title and registration documents are only available after completing identity verification.
                  </p>
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ marginTop: '12px', fontSize: '9px', padding: '4px 10px' }}
                    onClick={onClose}
                  >
                    Verify to view
                  </button>
                </div>
              ) : titleImages.length === 0 ? (
                <div style={S.gateCard}>No title or registration documents yet.</div>
              ) : (
                <div style={S.grid}>
                  {titleImages.map((img) => (
                    <div key={img.id} style={S.imgWrap}>
                      <img
                        src={img.image_url}
                        alt={getDocLabel(img.sensitive_type)}
                        style={S.img}
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VINProofImagesViewer;
