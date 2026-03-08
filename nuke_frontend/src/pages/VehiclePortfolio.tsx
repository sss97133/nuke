/**
 * VehiclePortfolio
 *
 * Clean, client-facing vehicle showcase.
 * Route: /vehicle/:vehicleId/portfolio
 *
 * Designed to be sent to a buyer — media first,
 * no internal data clutter. Documents vault at bottom.
 * No auth required.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────

interface Vehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  mileage: number | null;
  color: string | null;
  interior_color: string | null;
  engine_type: string | null;
  engine_liters: number | null;
  transmission_type: string | null;
  drivetrain: string | null;
  modifications: string | null;
  highlights: string | null;
  description: string | null;
  previous_owners: number | null;
  condition_rating: number | null;
  sale_price: number | null;
  bat_buyer: string | null;
}

interface VehicleImage {
  id: string;
  image_url: string;
  thumbnail_url: string | null;
  medium_url: string | null;
  large_url: string | null;
  variants: Record<string, string> | null;
  caption: string | null;
  is_primary: boolean;
  position: number | null;
}

interface VehicleDocument {
  id: string;
  document_type: string;
  title: string | null;
  description: string | null;
  file_url: string | null;
  file_type: string | null;
  created_at: string | null;
}

// ─── Constants ────────────────────────────────────────────────

const PAGE_SIZE = 48;

const DOC_TYPE_LABELS: Record<string, string> = {
  receipt: 'Purchase Receipt',
  invoice: 'Invoice',
  title: 'Certificate of Title',
  registration: 'Registration',
  insurance: 'Insurance',
  service_record: 'Service Record',
  parts_order: 'Parts Order',
  shipping_document: 'Shipping Document',
  legal_document: 'Legal Document',
};

// ─── Helpers ──────────────────────────────────────────────────

function getImageUrl(img: VehicleImage, size: 'thumb' | 'medium' | 'full'): string {
  const v = img.variants as any;
  if (size === 'thumb') return v?.thumbnail || img.thumbnail_url || img.medium_url || img.image_url;
  if (size === 'medium') return v?.medium || img.medium_url || img.image_url;
  return v?.large || img.large_url || img.image_url;
}

function docLabel(doc: VehicleDocument): string {
  if (doc.title) return doc.title;
  return DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ─── Component ────────────────────────────────────────────────

export default function VehiclePortfolio() {
  const { vehicleId } = useParams<{ vehicleId: string }>();

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [documents, setDocuments] = useState<VehicleDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);

  // ── Data loading ──────────────────────────────────────────

  useEffect(() => {
    if (vehicleId) load();
  }, [vehicleId]);

  const load = async () => {
    if (!vehicleId) return;
    setLoading(true);

    const [vRes, imgRes, docRes] = await Promise.all([
      supabase
        .from('vehicles')
        .select(
          'id, year, make, model, trim, vin, mileage, color, interior_color, ' +
          'engine_type, engine_liters, transmission_type, drivetrain, ' +
          'modifications, highlights, description, previous_owners, ' +
          'condition_rating, sale_price, bat_buyer'
        )
        .eq('id', vehicleId)
        .single(),

      supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, medium_url, large_url, variants, caption, is_primary, position')
        .eq('vehicle_id', vehicleId)
        .eq('is_sensitive', false)
        .not('image_vehicle_match_status', 'in', '("mismatch","unrelated")')
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .range(0, PAGE_SIZE - 1),

      supabase
        .from('vehicle_documents')
        .select('id, document_type, title, description, file_url, file_type, created_at')
        .eq('vehicle_id', vehicleId)
        .not('privacy_level', 'eq', 'private')
        .order('created_at', { ascending: false }),
    ]);

    if (vRes.data) setVehicle(vRes.data as Vehicle);
    if (imgRes.data) {
      setImages(imgRes.data as VehicleImage[]);
      setHasMore((imgRes.data?.length ?? 0) >= PAGE_SIZE);
    }
    if (docRes.data) setDocuments(docRes.data as VehicleDocument[]);

    setLoading(false);
  };

  const loadMore = async () => {
    if (!vehicleId || loadingMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const { data } = await supabase
      .from('vehicle_images')
      .select('id, image_url, thumbnail_url, medium_url, large_url, variants, caption, is_primary, position')
      .eq('vehicle_id', vehicleId)
      .eq('is_sensitive', false)
      .not('image_vehicle_match_status', 'in', '("mismatch","unrelated")')
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(nextPage * PAGE_SIZE, (nextPage + 1) * PAGE_SIZE - 1);

    if (data) {
      setImages(prev => [...prev, ...(data as VehicleImage[])]);
      setHasMore(data.length >= PAGE_SIZE);
      setPage(nextPage);
    }
    setLoadingMore(false);
  };

  // ── Lightbox keyboard nav ─────────────────────────────────

  const lightboxPrev = useCallback(() => setLightbox(i => i !== null ? Math.max(0, i - 1) : null), []);
  const lightboxNext = useCallback(() => setLightbox(i => i !== null ? Math.min(images.length - 1, i + 1) : null), [images.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (lightbox === null) return;
      if (e.key === 'ArrowLeft') lightboxPrev();
      if (e.key === 'ArrowRight') lightboxNext();
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox, lightboxPrev, lightboxNext]);

  // ── Render states ─────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.loadingWrap}>
        <span style={styles.loadingText}>Loading</span>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div style={styles.loadingWrap}>
        <span style={styles.loadingText}>Vehicle not found</span>
      </div>
    );
  }

  // ── Derived display values ────────────────────────────────

  const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const heroImage = images.find(i => i.is_primary) ?? images[0];

  const specParts: string[] = [
    vehicle.color ?? '',
    vehicle.engine_liters && vehicle.engine_type
      ? `${vehicle.engine_liters}L ${vehicle.engine_type}`
      : (vehicle.engine_type ?? ''),
    vehicle.transmission_type ?? '',
    vehicle.drivetrain ?? '',
    vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} mi` : '',
    vehicle.previous_owners != null
      ? `${vehicle.previous_owners} prev owner${vehicle.previous_owners !== 1 ? 's' : ''}`
      : '',
  ].filter(Boolean);

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={styles.root}>

      {/* ── Header ────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logoText}>NUKE</span>
          <span style={styles.headerDivider}>|</span>
          <span style={styles.headerVehicle}>{title}</span>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────── */}
      {heroImage && (
        <section style={styles.heroSection}>
          <img
            src={getImageUrl(heroImage, 'full')}
            alt={title}
            style={styles.heroImg}
            onError={e => { (e.target as HTMLImageElement).src = getImageUrl(heroImage, 'medium'); }}
          />
          <div style={styles.heroOverlay} />
          <div style={styles.heroCaption}>
            <p style={styles.heroCaptionLabel}>Vehicle Portfolio</p>
            <h1 style={styles.heroTitle}>{title}</h1>
            {vehicle.trim && (
              <p style={styles.heroSubtitle}>{vehicle.trim}</p>
            )}
          </div>
        </section>
      )}

      {/* ── Specs Strip ───────────────────────────────────── */}
      <div style={styles.specsStrip}>
        {specParts.map((s, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={styles.specValue}>{s}</span>
            {i < specParts.length - 1 && <span style={styles.specDot}>·</span>}
          </span>
        ))}
        {vehicle.vin && (
          <>
            <span style={styles.specDot}>·</span>
            <span style={styles.specVin}>{vehicle.vin}</span>
          </>
        )}
      </div>

      {/* ── Highlights / About ────────────────────────────── */}
      {(vehicle.highlights || vehicle.description || vehicle.modifications) && (
        <section style={styles.aboutSection}>
          <div style={styles.aboutInner}>
            {(vehicle.highlights || vehicle.description) && (
              <div style={styles.aboutBlock}>
                <h2 style={styles.sectionLabel}>About</h2>
                <p style={styles.aboutText}>
                  {vehicle.highlights || vehicle.description}
                </p>
              </div>
            )}
            {vehicle.modifications && (
              <div style={styles.aboutBlock}>
                <h2 style={styles.sectionLabel}>Modifications</h2>
                <p style={styles.aboutText}>{vehicle.modifications}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Gallery ───────────────────────────────────────── */}
      {images.length > 0 && (
        <section style={styles.gallerySection}>
          <div style={styles.galleryHeader}>
            <h2 style={styles.sectionLabel}>Gallery</h2>
            <span style={styles.galleryCount}>{images.length} photos</span>
          </div>

          {/* CSS columns masonry */}
          <div style={styles.masonryGrid}>
            {images.map((img, idx) => (
              <GalleryTile
                key={img.id}
                img={img}
                idx={idx}
                onClick={() => setLightbox(idx)}
              />
            ))}
          </div>

          {hasMore && (
            <div style={styles.loadMoreWrap}>
              <button onClick={loadMore} disabled={loadingMore} style={styles.loadMoreBtn}>
                {loadingMore ? 'Loading…' : 'Load More'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Documents Vault ───────────────────────────────── */}
      {documents.length > 0 && (
        <section style={styles.docsSection}>
          <div style={styles.docsDivider} />
          <h2 style={{ ...styles.sectionLabel, marginBottom: '20px' }}>Documents</h2>
          <div style={styles.docsGrid}>
            {documents.map(doc => (
              <DocCard key={doc.id} doc={doc} label={docLabel(doc)} />
            ))}
          </div>
        </section>
      )}

      {/* ── Footer ────────────────────────────────────────── */}
      <footer style={styles.footer}>
        <span style={styles.footerBrand}>NUKE LTD · Vehicle Records Platform</span>
        {vehicle.vin && <span style={styles.footerVin}>{vehicle.vin}</span>}
      </footer>

      {/* ── Lightbox ──────────────────────────────────────── */}
      {lightbox !== null && (
        <div style={styles.lightboxBackdrop} onClick={() => setLightbox(null)}>
          <img
            src={getImageUrl(images[lightbox], 'full')}
            alt=""
            style={styles.lightboxImg}
            onClick={e => e.stopPropagation()}
            onError={e => { (e.target as HTMLImageElement).src = getImageUrl(images[lightbox], 'medium'); }}
          />

          {lightbox > 0 && (
            <button
              style={{ ...styles.lightboxNavBtn, left: '20px' }}
              onClick={e => { e.stopPropagation(); lightboxPrev(); }}
            >‹</button>
          )}

          {lightbox < images.length - 1 && (
            <button
              style={{ ...styles.lightboxNavBtn, right: '20px' }}
              onClick={e => { e.stopPropagation(); lightboxNext(); }}
            >›</button>
          )}

          <button style={styles.lightboxCloseBtn} onClick={() => setLightbox(null)}>×</button>

          <div style={styles.lightboxCounter}>
            {lightbox + 1} / {images.length}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function GalleryTile({ img, idx, onClick }: { img: VehicleImage; idx: number; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ ...styles.galleryTile, ...(hovered ? styles.galleryTileHover : {}) }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={getImageUrl(img, 'medium')}
        alt={img.caption || `Photo ${idx + 1}`}
        loading="lazy"
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />
    </div>
  );
}

function DocCard({ doc, label }: { doc: VehicleDocument; label: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={doc.file_url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...styles.docCard, ...(hovered ? styles.docCardHover : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.docIcon}>
        <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
          <path d="M11 1H3C1.9 1 1 1.9 1 3V19C1 20.1 1.9 21 3 21H15C16.1 21 17 20.1 17 19V7L11 1Z" stroke="var(--text-disabled)" strokeWidth="1.5" fill="none" />
          <path d="M11 1V7H17" stroke="var(--text-disabled)" strokeWidth="1.5" />
          <line x1="5" y1="12" x2="13" y2="12" stroke="var(--border)" strokeWidth="1.5" />
          <line x1="5" y1="16" x2="10" y2="16" stroke="var(--border)" strokeWidth="1.5" />
        </svg>
      </div>
      <div style={styles.docInfo}>
        <p style={styles.docLabel}>{label}</p>
        {doc.description && (
          <p style={styles.docDesc}>{doc.description}</p>
        )}
        {doc.created_at && (
          <p style={styles.docDate}>{formatDate(doc.created_at)}</p>
        )}
      </div>
      <span style={styles.docArrow}>↗</span>
    </a>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    background: 'var(--bg)',
    minHeight: '100vh',
    fontFamily: '"Inter", "SF Pro Display", system-ui, -apple-system, sans-serif',
    color: 'var(--text)',
  },

  // Loading
  loadingWrap: {
    background: 'var(--text)',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: 'var(--text-secondary)',
    fontSize: '11px',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    fontFamily: 'system-ui',
  },

  // Header
  header: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    height: '52px',
    background: 'rgba(245, 243, 239, 0.90)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 28px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  logoText: {
    fontWeight: 800,
    fontSize: '13px',
    letterSpacing: '0.15em',
    color: 'var(--text)',
  },
  headerDivider: {
    color: 'var(--border)',
    fontSize: '14px',
  },
  headerVehicle: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    letterSpacing: '0.03em',
  },

  // Hero
  heroSection: {
    position: 'relative',
    height: '100vh',
    overflow: 'hidden',
  },
  heroImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  heroOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, transparent 35%, transparent 50%, rgba(0,0,0,0.72) 100%)',
    pointerEvents: 'none',
  },
  heroCaption: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '48px 40px',
  },
  heroCaptionLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: '10px',
    letterSpacing: '0.25em',
    textTransform: 'uppercase',
    marginBottom: '10px',
    margin: '0 0 10px',
  },
  heroTitle: {
    color: 'var(--bg)',
    fontSize: 'clamp(36px, 5.5vw, 72px)',
    fontWeight: 700,
    lineHeight: 1.0,
    letterSpacing: '-0.025em',
    margin: 0,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: '18px',
    marginTop: '10px',
    fontWeight: 400,
    letterSpacing: '0.03em',
    margin: '10px 0 0',
  },

  // Specs Strip
  specsStrip: {
    background: 'var(--text)',
    padding: '16px 40px',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '4px 0',
  },
  specValue: {
    color: 'var(--warning)',
    fontSize: '12px',
    fontWeight: 500,
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  },
  specDot: {
    color: 'var(--surface)',
    margin: '0 14px',
    fontSize: '12px',
  },
  specVin: {
    color: 'var(--text-secondary)',
    fontSize: '11px',
    fontFamily: '"SF Mono", "Fira Code", monospace',
    letterSpacing: '0.06em',
  },

  // About
  aboutSection: {
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
  },
  aboutInner: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '48px 40px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '40px',
  },
  aboutBlock: {},
  sectionLabel: {
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: 'var(--text-disabled)',
    margin: '0 0 14px',
  },
  aboutText: {
    fontSize: '14px',
    lineHeight: 1.7,
    color: 'var(--text)',
    margin: 0,
  },

  // Gallery
  gallerySection: {
    padding: '56px 32px 48px',
    maxWidth: '1600px',
    margin: '0 auto',
  },
  galleryHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '14px',
    marginBottom: '24px',
  },
  galleryCount: {
    fontSize: '11px',
    color: 'var(--text-disabled)',
  },
  masonryGrid: {
    columns: 'auto 280px',
    columnGap: '6px',
  },
  galleryTile: {
    breakInside: 'avoid',
    marginBottom: '6px',
    cursor: 'pointer',
    overflow: 'hidden',
    borderRadius: '2px',
    transition: 'opacity 0.2s',
  },
  galleryTileHover: {
    opacity: 0.88,
  },
  loadMoreWrap: {
    textAlign: 'center',
    marginTop: '36px',
  },
  loadMoreBtn: {
    background: 'none',
    border: '1px solid var(--border)',
    padding: '10px 36px',
    fontSize: '11px',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    borderRadius: '2px',
    transition: 'border-color 0.15s',
  },

  // Documents
  docsSection: {
    padding: '0 40px 72px',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  docsDivider: {
    height: '1px',
    background: 'var(--border)',
    margin: '0 0 48px',
  },
  docsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '10px',
  },
  docCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px 18px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  docCardHover: {
    borderColor: 'var(--text-disabled)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  docIcon: {
    flexShrink: 0,
    width: '36px',
    height: '44px',
    background: 'var(--bg)',
    borderRadius: '3px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docInfo: {
    flex: 1,
    minWidth: 0,
  },
  docLabel: {
    margin: 0,
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--text)',
    lineHeight: 1.3,
  },
  docDesc: {
    margin: '3px 0 0',
    fontSize: '11px',
    color: 'var(--text-disabled)',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  docDate: {
    margin: '5px 0 0',
    fontSize: '11px',
    color: 'var(--border)',
  },
  docArrow: {
    color: 'var(--border)',
    fontSize: '16px',
    flexShrink: 0,
  },

  // Footer
  footer: {
    background: 'var(--text)',
    padding: '22px 40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '8px',
  },
  footerBrand: {
    color: 'var(--text-secondary)',
    fontSize: '11px',
    letterSpacing: '0.1em',
  },
  footerVin: {
    color: 'var(--text)',
    fontSize: '11px',
    fontFamily: '"SF Mono", monospace',
    letterSpacing: '0.06em',
  },

  // Lightbox
  lightboxBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 100,
    background: 'rgba(0,0,0,0.96)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImg: {
    maxWidth: '92vw',
    maxHeight: '92vh',
    objectFit: 'contain',
    borderRadius: '2px',
  },
  lightboxNavBtn: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'rgba(255,255,255,0.12)',
    border: 'none',
    color: 'var(--bg)',
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    fontSize: '24px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
  lightboxCloseBtn: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    background: 'rgba(255,255,255,0.12)',
    border: 'none',
    color: 'var(--bg)',
    width: '38px',
    height: '38px',
    borderRadius: '50%',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
  lightboxCounter: {
    position: 'absolute',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '12px',
    letterSpacing: '0.1em',
  },
};
