import React, { useState } from 'react';
import type { VehicleHeroImageProps } from './types';
import MobileImageGallery from '../../components/image/MobileImageGallery';
import { useIsMobile } from '../../hooks/useIsMobile';

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ leadImageUrl, overlayNode }) => {
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
  if (!src || src === 'undefined' || src === 'null') return null;

  const renderUrl = getSupabaseRenderUrl(src, 1600, 90);
  const imgUrl = renderUrl || src;

  return (
    <>
      <section className="section">
        <div className="card" style={{ border: 'none', overflow: 'hidden' }}>
          <div
            style={{
              width: '100%',
              aspectRatio: '16/9',
              maxHeight: '600px',
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 'var(--radius-2)',
              backgroundColor: '#111',
              cursor: isMobile ? 'pointer' : 'default',
            }}
            onClick={() => isMobile && setShowGallery(true)}
          >
            {/* Blurred backdrop — only shown in fit mode, fills empty sides */}
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
      </section>

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
