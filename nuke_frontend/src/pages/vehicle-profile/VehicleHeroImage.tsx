import React, { useState } from 'react';
import type { VehicleHeroImageProps } from './types';
import MobileImageGallery from '../../components/image/MobileImageGallery';
import { useIsMobile } from '../../hooks/useIsMobile';

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ leadImageUrl, overlayNode }) => {
  const [showGallery, setShowGallery] = useState(false);
  const isMobile = useIsMobile();
  
  const getSupabaseRenderUrl = (publicObjectUrl: string, width: number, quality: number = 80): string | null => {
    try {
      const url = String(publicObjectUrl || '').trim();
      if (!url) return null;
      const marker = '/storage/v1/object/public/';
      const idx = url.indexOf(marker);
      if (idx < 0) return null;
      const base = url.slice(0, idx);
      const path = url.slice(idx + marker.length);
      if (!path) return null;
      const cleanPath = path.split('?')[0];
      return `${base}/storage/v1/render/image/public/${cleanPath}?width=${encodeURIComponent(String(width))}&quality=${encodeURIComponent(String(quality))}`;
    } catch {
      return null;
    }
  };

  // Get the source URL - just use it if it exists
  const src = leadImageUrl ? String(leadImageUrl).trim() : '';
  
  // Only return null if we have absolutely nothing
  if (!src || src === 'undefined' || src === 'null' || src.length === 0) {
    return null;
  }
  
  // Build sources array - try to get render URL first for optimization, but always include original as fallback
  const renderFallback = getSupabaseRenderUrl(src, 1600, 85);
  // Always include original URL as fallback - ResilientImage will try render URL first, then fall back to original
  const sources = renderFallback ? [renderFallback, src] : [src];
  const finalSources = sources.filter(Boolean) as string[];
  // Prefer the optimized render URL, but also include the original URL as a fallback.
  // For CSS backgrounds, we can provide a layered list: if the first fails, the next can still show.
  const hiResUrl = finalSources[0] || src;
  const backgroundImageCss =
    finalSources.length >= 2 ? `url(${finalSources[0]}), url(${finalSources[1]})` : `url(${hiResUrl})`;

  return (
    <>
    <section className="section">
      <div className="card" style={{ border: 'none', overflow: 'hidden' }}>
        <div
          className="hero-image"
          onClick={() => isMobile && setShowGallery(true)}
          style={{
            width: '100%',
            height: '400px',
            borderRadius: '0px',
            position: 'relative',
            cursor: isMobile ? 'pointer' : 'default',
            overflow: 'hidden',
            backgroundColor: 'var(--bg)', // Fallback background
            backgroundImage: backgroundImageCss,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          {overlayNode ? <div style={{ position: 'relative', zIndex: 1 }}>{overlayNode}</div> : null}
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