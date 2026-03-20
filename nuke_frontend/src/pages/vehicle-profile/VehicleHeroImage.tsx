import React, { useState } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import MobileImageGallery from '../../components/image/MobileImageGallery';
import { useIsMobile } from '../../hooks/useIsMobile';

interface VehicleHeroImageProps {
  overlayNode?: React.ReactNode;
}

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ overlayNode }) => {
  const { leadImageUrl, heroMeta } = useVehicleProfile();
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

  const src = leadImageUrl ? String(leadImageUrl).trim() : '';
  if (!src || src === 'undefined' || src === 'null') {
    // Show a minimal placeholder so the hero area exists
    return (
      <div style={{
        width: '100%',
        height: 'var(--h-hero, 420px)',
        backgroundColor: '#2a2a2a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          color: '#888',
        }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="12" width="40" height="28" stroke="currentColor" strokeWidth="2" fill="none"/>
            <circle cx="18" cy="22" r="4" stroke="currentColor" strokeWidth="2" fill="none"/>
            <path d="M4 34 L14 24 L20 30 L30 20 L44 34" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none"/>
          </svg>
          <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>No photo available</span>
        </div>
      </div>
    );
  }

  const renderUrl = getSupabaseRenderUrl(src, 1600, 90);
  const imgUrl = renderUrl || src;

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
                backgroundColor: '#2a2a2a',
                cursor: isMobile ? 'pointer' : 'default',
              }}
              onClick={() => isMobile && setShowGallery(true)}
            >
              {/* Blurred backdrop in contain mode */}
              {fitMode === 'contain' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: '-30px',
                    backgroundImage: `url(${imgUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    filter: 'blur(28px) brightness(0.45)',
                  }}
                />
              )}

              {/* Image — fixed frame, toggle between contain and cover */}
              <img
                src={renderUrl || src}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: fitMode,
                  objectPosition: 'center',
                }}
                onError={(e) => {
                  if (renderUrl && (e.target as HTMLImageElement).src !== src) {
                    (e.target as HTMLImageElement).src = src;
                  }
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
                  color: '#fff',
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
