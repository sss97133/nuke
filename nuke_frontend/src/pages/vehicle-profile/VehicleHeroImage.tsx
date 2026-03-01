import React, { useState } from 'react';
import type { VehicleHeroImageProps } from './types';
import MobileImageGallery from '../../components/image/MobileImageGallery';
import { useIsMobile } from '../../hooks/useIsMobile';

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ leadImageUrl, overlayNode, heroMeta }) => {
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');
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
        aspectRatio: '16/9',
        maxHeight: '280px',
        backgroundColor: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          color: 'var(--text-muted)',
        }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="12" width="40" height="28" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
            <circle cx="18" cy="22" r="4" stroke="currentColor" strokeWidth="2" fill="none"/>
            <path d="M4 34 L14 24 L20 30 L30 20 L44 34" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none"/>
          </svg>
          <span style={{ fontSize: '12px', fontWeight: 500 }}>No photo available</span>
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
                aspectRatio: '16/9',
                maxHeight: '360px',
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: 'var(--grey-950, #111)',
                cursor: isMobile ? 'pointer' : 'default',
              }}
              onClick={() => isMobile && setShowGallery(true)}
            >
              {/* Blurred backdrop -- only shown in fit mode, fills empty sides */}
              {fitMode === 'contain' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: '-30px', // extend past edges to hide blur fringe
                    backgroundImage: `url(${imgUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    filter: 'blur(28px) brightness(0.45)',
                  }}
                />
              )}

              {/* Main image */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: renderUrl ? `url(${renderUrl}), url(${src})` : `url(${src})`,
                  backgroundSize: fitMode,
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }}
              />

              {/* Overlay (auction banners etc) */}
              {overlayNode && (
                <div style={{ position: 'relative', zIndex: 1 }}>{overlayNode}</div>
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
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  zIndex: 2,
                  backdropFilter: 'blur(6px)',
                  letterSpacing: '0.04em',
                }}
              >
                {fitMode === 'cover' ? 'Fit' : 'Fill'}
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
