import React from 'react';
import type { VehicleHeroImageProps } from './types';

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ leadImageUrl }) => {
  if (!leadImageUrl) return null;

  // Use large_url if available, otherwise fallback to original image_url
  // Note: large_url is a separate column, not a path transformation
  const hiResUrl = leadImageUrl;  // Use original until large variants are generated

  return (
    <section className="section">
      <div className="card">
        <div
          className="hero-image"
          style={{
            backgroundImage: `url(${hiResUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            height: '400px',
            borderRadius: 'var(--radius)',
            position: 'relative'
          }}
        />
      </div>
    </section>
  );
};

export default VehicleHeroImage;