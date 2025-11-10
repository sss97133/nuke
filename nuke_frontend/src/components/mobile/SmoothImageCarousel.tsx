/**
 * Instagram-Smooth Image Carousel
 * Uses Swiper.js for buttery-smooth native-feeling swipes
 */

import React from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination, Zoom } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/pagination';
import 'swiper/css/zoom';

interface SmoothImageCarouselProps {
  images: string[];
  onImageChange?: (index: number) => void;
}

export const SmoothImageCarousel: React.FC<SmoothImageCarouselProps> = ({ 
  images,
  onImageChange 
}) => {
  if (!images || images.length === 0) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>No images yet</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <Swiper
        modules={[Pagination, Zoom]}
        spaceBetween={0}
        slidesPerView={1}
        speed={300} // Smooth, not too fast
        touchRatio={1.5} // More responsive to touch
        resistance={true}
        resistanceRatio={0.85}
        threshold={5} // Sensitivity
        pagination={{
          clickable: true,
          dynamicBullets: true,
          dynamicMainBullets: 3,
        }}
        zoom={{
          maxRatio: 3,
          minRatio: 1,
        }}
        onSlideChange={(swiper) => {
          onImageChange?.(swiper.activeIndex);
        }}
        style={{ 
          width: '100%', 
          height: '400px',
          background: '#000'
        }}
      >
        {images.map((imageUrl, index) => (
          <SwiperSlide key={index}>
            <div className="swiper-zoom-container">
              <img
                src={imageUrl}
                alt={`Image ${index + 1}`}
                style={styles.image}
                loading={index === 0 ? 'eager' : 'lazy'}
              />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    position: 'relative',
    background: '#000',
    touchAction: 'pan-y pinch-zoom', // Better touch handling
  },
  image: {
    width: '100%',
    height: '400px',
    objectFit: 'contain',
    display: 'block',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
  },
  empty: {
    width: '100%',
    height: '200px',
    background: '#f0f0f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid #ccc',
  },
  emptyText: {
    color: '#888',
    fontSize: '14px',
  },
};

