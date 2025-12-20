import React, { useState } from 'react';
import type { VehicleHeroImageProps } from './types';
import MobileImageGallery from '../../components/image/MobileImageGallery';
import { useIsMobile } from '../../hooks/useIsMobile';
import ResilientImage from '../../components/images/ResilientImage';

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

  // Validate leadImageUrl - ensure it's a valid non-empty string
  const src = leadImageUrl ? String(leadImageUrl).trim() : '';
  
  // Return null if no valid URL (empty, null, undefined, or invalid strings)
  if (!src || src === 'undefined' || src === 'null' || !src.startsWith('http')) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[VehicleHeroImage] Invalid leadImageUrl, not rendering:', { leadImageUrl, src });
    }
    return null;
  }
  
  const renderFallback = getSupabaseRenderUrl(src, 1600, 85);
  const sources = [renderFallback, src].filter(Boolean) as string[];
  
  // Ensure we have at least one valid source
  if (sources.length === 0) {
    return null;
  }

  return (
    <>
    <section className="section">
      <div className="card" style={{ border: 'none', overflow: 'hidden' }}>
        <div
          className="hero-image"
          onClick={() => isMobile && setShowGallery(true)}
          style={{
            width: '100%',
            minHeight: '400px',
            borderRadius: '0px',
            position: 'relative',
            cursor: isMobile ? 'pointer' : 'default',
            overflow: 'hidden',
            backgroundColor: 'var(--bg)', // Fallback background
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <ResilientImage
            sources={sources}
            alt="Vehicle hero image"
            fill={true}
            objectFit="contain"
            style={{ objectPosition: 'center' }}
            placeholderSrc="/n-zero.png"
            placeholderOpacity={0.25}
          />
          {overlayNode}
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