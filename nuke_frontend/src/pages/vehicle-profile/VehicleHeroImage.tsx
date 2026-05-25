import React, { useState, useEffect, useCallback } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import MobileImageGallery from '../../components/image/MobileImageGallery';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BadgePortal } from '../../components/badges/BadgePortal';
import VehicleMediaKit from './VehicleMediaKit';

interface VehicleHeroImageProps {
  overlayNode?: React.ReactNode;
}

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ overlayNode }) => {
  const { leadImageUrl, heroMeta, vehicleId } = useVehicleProfile();
  // Default to contain: show the full vehicle, letterbox if needed.
  // "The user came to see the vehicle, not a cropped fragment." — 2026-03-21 audit
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [showGallery, setShowGallery] = useState(false);
  // Media-kit slideshow: rendered when curation finds >=3 distinct BYOK scene_types.
  // Initialized to true so the slot reserves space — flips to false if curation falls back.
  const [mediaKitActive, setMediaKitActive] = useState<boolean>(true);
  const isMobile = useIsMobile();

  const handleCurationResolved = useCallback((count: number) => {
    setMediaKitActive(count >= 3);
  }, []);

  const getSupabaseRenderUrl = (publicObjectUrl: string, width: number, quality = 90): string | null => {
    try {
      const url = String(publicObjectUrl || '').trim();
      if (!url) return null;
      const marker = '/storage/v1/object/public/';
      const idx = url.indexOf(marker);
      if (idx < 0) return null;
      const base = url.slice(0, idx);
      const path = url.slice(idx + marker.length).split('?')[0];
      if (!path) return null;
      // resize=contain required — Supabase /render/image defaults to resize=cover which crops portrait iPhone photos.
      return `${base}/storage/v1/render/image/public/${path}?width=${width}&quality=${quality}&resize=contain`;
    } catch {
      return null;
    }
  };

  const { vehicle } = useVehicleProfile();
  const v = vehicle as any;

  const src = leadImageUrl ? String(leadImageUrl).trim() : '';

  // Build srcset + heroSrc unconditionally (no-photo branch ignores them).
  // Skip Supabase render endpoint for hero — it strips EXIF orientation,
  // causing landscape photos to display as portrait. Browsers handle EXIF
  // orientation natively (image-orientation: from-image is default in all
  // modern browsers). Use original URL for correct orientation.
  const imgUrl = src;
  const srcset420 = getSupabaseRenderUrl(imgUrl, 420);
  const srcset840 = getSupabaseRenderUrl(imgUrl, 840);
  const srcset1260 = getSupabaseRenderUrl(imgUrl, 1260);
  const srcSetAttr = (srcset420 && srcset840 && srcset1260)
    ? `${srcset420} 420w, ${srcset840} 840w, ${srcset1260} 1260w`
    : undefined;
  const heroSrc = srcset840 || imgUrl;

  // <link rel=preload> for the hero — tells the browser to start the fetch
  // before React paints the <img>. Only meaningful when media-kit is NOT
  // active (the slideshow's first frame self-preloads via fetchpriority).
  // Declared before the no-photo early-return so hooks-order is stable.
  useEffect(() => {
    if (mediaKitActive) return;
    if (!heroSrc || typeof document === 'undefined') return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = heroSrc;
    if (srcSetAttr) (link as any).imagesrcset = srcSetAttr;
    (link as any).imagesizes = '(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 1260px';
    (link as any).fetchPriority = 'high';
    document.head.appendChild(link);
    return () => {
      try { document.head.removeChild(link); } catch { /* noop */ }
    };
  }, [heroSrc, srcSetAttr, mediaKitActive]);

  if (!src || src === 'undefined' || src === 'null') {
    // No photo: show spec card with clickable badges (zero dead ends)
    return (
      <div style={{
        width: '100%',
        height: 'var(--h-hero, 420px)',
        backgroundColor: 'var(--text)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          color: 'var(--text-disabled)',
          maxWidth: '400px',
        }}>
          {/* Vehicle identity */}
          <div style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.5px',
            color: 'var(--surface)',
            textAlign: 'center',
          }}>
            {[v?.year, v?.make, v?.model].filter(Boolean).join(' ') || 'VEHICLE'}
          </div>

          {/* Badge portals — every piece of data is explorable */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
            {v?.year && <BadgePortal dimension="year" value={v.year} label={String(v.year)} variant="source" />}
            {v?.make && <BadgePortal dimension="make" value={v.make} label={String(v.make).toUpperCase()} variant="source" />}
            {v?.model && <BadgePortal dimension="model" value={v.model} label={String(v.model).toUpperCase()} variant="source" />}
            {v?.body_style && <BadgePortal dimension="body_style" value={v.body_style} label={String(v.body_style).toUpperCase()} variant="status" />}
            {v?.transmission && (
              <BadgePortal
                dimension="transmission"
                value={v.transmission}
                label={String(v.transmission).toLowerCase().includes('manual') ? 'MANUAL' : 'AUTO'}
                variant="status"
              />
            )}
          </div>

          <span style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '8px',
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase' as const,
            marginTop: '4px',
          }}>
            NO PHOTO · EXPLORE BY BADGE
          </span>
        </div>
      </div>
    );
  }

  // Build metadata parts (only render fields that exist)
  const metaParts: string[] = [];
  if (heroMeta?.camera) metaParts.push(heroMeta.camera);
  if (heroMeta?.location) metaParts.push(heroMeta.location);
  if (heroMeta?.date) metaParts.push(heroMeta.date);

  return (
    <>
      <div>
        <div style={{ overflow: 'hidden' }}>
          {/* hero-media-slot: static image now, carousel/livestream later */}
          <div className="hero-media-slot">
            <div
              style={{
                width: '100%',
                height: 'var(--h-hero, 420px)',
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: 'var(--text)',
                cursor: isMobile ? 'pointer' : 'default',
              }}
              onClick={() => isMobile && setShowGallery(true)}
            >
              {/* Dark backdrop in contain mode — solid color, not blurred image.
                  CSS background-image doesn't reliably respect EXIF orientation,
                  and the blur effect looks bad on portrait images. */}
              {fitMode === 'contain' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'var(--text)',
                  }}
                />
              )}

              {/* Media-kit slideshow when curation finds >=3 distinct BYOK
                  scene_types; falls back to single hero <img> otherwise.
                  VehicleMediaKit calls onCurationResolved with 0 when it can't
                  curate, which flips mediaKitActive to false and reveals the
                  <img> path below. */}
              {vehicleId && mediaKitActive && (
                <VehicleMediaKit
                  vehicleId={vehicleId}
                  onCurationResolved={handleCurationResolved}
                  onImageClick={isMobile ? () => setShowGallery(true) : undefined}
                />
              )}

              {/* Image — fixed frame, toggle between contain and cover.
                  Speed: eager+async+fetchpriority=high on LCP candidate.
                  srcset/sizes lets mobile pull a 420w variant. */}
              {!mediaKitActive && (
                <img
                  src={heroSrc}
                  srcSet={srcSetAttr}
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 1260px"
                  alt=""
                  loading="eager"
                  decoding="async"
                  {...({ fetchpriority: 'high' } as any)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: fitMode,
                    objectPosition: 'center',
                  }}
                />
              )}

              {/* Overlay (auction banners etc) */}
              {overlayNode && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 }}>{overlayNode}</div>
              )}

              {/* Fit / Fill toggle — hidden when slideshow is active (slideshow uses contain only). */}
              {!mediaKitActive && (
              <button
                onClick={e => { e.stopPropagation(); setFitMode(m => m === 'cover' ? 'contain' : 'cover'); }}
                style={{
                  position: 'absolute',
                  bottom: '10px',
                  right: '10px',
                  background: 'rgba(0,0,0,0.55)',
                  color: 'var(--surface-elevated)',
                  border: 'none', padding: '2px 6px',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '8px',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase' as const,
                  cursor: 'pointer',
                  zIndex: 2,
                  backdropFilter: 'blur(6px)',
                  transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {fitMode === 'cover' ? 'FIT' : 'FILL'}
              </button>
              )}
            </div>
          </div>

          {/* Metadata bar removed — clean hero like BaT */}
        </div>
      </div>

      {isMobile && showGallery && (
        <MobileImageGallery
          leadImageUrl={leadImageUrl}
          onClose={() => setShowGallery(false)}
        />
      )}
    </>
  );
};

export default VehicleHeroImage;
