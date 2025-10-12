import React from 'react';
import type { VehicleHeroImageProps } from './types';

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ leadImageUrl }) => {
  if (!leadImageUrl) return null;

  return (
    <section className="section">
      <div className="card">
        <div
          className="hero-image"
          style={{
            backgroundImage: `url(${leadImageUrl})`,
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