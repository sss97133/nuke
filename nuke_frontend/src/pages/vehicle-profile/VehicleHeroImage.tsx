import React, { useState } from 'react';
import type { VehicleHeroImageProps } from './types';
import MobileImageGallery from '../../components/image/MobileImageGallery';
import { useIsMobile } from '../../hooks/useIsMobile';
import ResilientImage from '../../components/images/ResilientImage';

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ leadImageUrl, overlayNode }) => {
  const [showGallery, setShowGallery] = useState(false);
  const isMobile = useIsMobile();
  
  if (!leadImageUrl) return null;

  // Use large_url if available, otherwise fallback to original image_url
  // Note: large_url is a separate column, not a path transformation
  const hiResUrl = leadImageUrl;  // Use original until large variants are generated

  return (
    <>
    <section className="section">
      <div className="card" style={{ border: 'none', overflow: 'hidden' }}>
        <div
          className="hero-image"
          onClick={() => isMobile && setShowGallery(true)}
          style={{
            height: '400px',
            borderRadius: '0px',
            position: 'relative',
            cursor: isMobile ? 'pointer' : 'default',
            overflow: 'hidden',
            backgroundColor: 'var(--bg)' // Fallback background
          }}
        >
          <ResilientImage
            sources={[hiResUrl]}
            alt="Vehicle hero image"
            fill={true}
            objectFit="cover"
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