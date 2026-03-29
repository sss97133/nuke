import React, { useState } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import MobileImageGallery from '../../components/image/MobileImageGallery';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BadgePortal } from '../../components/badges/BadgePortal';

interface VehicleHeroImageProps {
  overlayNode?: React.ReactNode;
}

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ overlayNode }) => {
  const { leadImageUrl, heroMeta } = useVehicleProfile();
  // Default to contain: show the full vehicle, letterbox if needed.
  // "The user came to see the vehicle, not a cropped fragment." — 2026-03-21 audit
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [showGallery, setShowGallery] = useState(false);
  const isMobile = useIsMobile();

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
      return `${base}/storage/v1/render/image/public/${path}?width=${width}&quality=${quality}`;
    } catch {
      return null;
    }
  };

  const { vehicle } = useVehicleProfile();
  const v = vehicle as any;

  const src = leadImageUrl ? String(leadImageUrl).trim() : '';
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

  // Skip Supabase render endpoint for hero — it strips EXIF orientation,
  // causing landscape photos to display as portrait. Browsers handle EXIF
  // orientation natively (image-orientation: from-image is default in all
  // modern browsers). Use original URL for correct orientation.
  const imgUrl = src;

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
                    background: '#111',
                  }}
                />
              )}

              {/* Image — fixed frame, toggle between contain and cover */}
              <img
                src={imgUrl}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: fitMode,
                  objectPosition: 'center',
                }}
              />

              {/* Overlay (auction banners etc) */}
              {overlayNode && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 }}>{overlayNode}</div>
              )}

              {/* Fit / Fill toggle */}
              <button
                onClick={e => { e.stopPropagation(); setFitMode(m => m === 'cover' ? 'contain' : 'cover'); }}
                style={{
                  position: 'absolute',
                  bottom: '10px',
                  right: '10px',
                  background: 'rgba(0,0,0,0.55)',
                  color: 'var(--surface-elevated)',
                  border: 'none', padding: '2px 6px',
                  fontFamily: 'Arial, Helvetica, sans-serif',
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
