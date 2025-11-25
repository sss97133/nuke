import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';

interface MobileImageGalleryProps {
  leadImageUrl: string;
  onClose: () => void;
}

interface VehicleImage {
  id: string;
  image_url: string;
  large_url?: string;
  caption?: string;
  angle_tag?: string;
  created_at: string;
}

const MobileImageGallery: React.FC<MobileImageGalleryProps> = ({ leadImageUrl, onClose }) => {
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);
  const [touchEndY, setTouchEndY] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const minSwipeDistance = 50;

  useEffect(() => {
    // Extract vehicle ID from URL or context
    const pathParts = window.location.pathname.split('/');
    const vehicleId = pathParts[pathParts.indexOf('vehicles') + 1];
    
    if (vehicleId) {
      loadImages(vehicleId);
    }
  }, []);

  const loadImages = async (vehicleId: string) => {
    const { data, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url, large_url, caption, angle_tag, created_at')
      .eq('vehicle_id', vehicleId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false });

    if (!error && data) {
      setImages(data);
      // Find index of lead image
      const leadIndex = data.findIndex(img => img.image_url === leadImageUrl || img.large_url === leadImageUrl);
      if (leadIndex >= 0) {
        setCurrentIndex(leadIndex);
      }
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEndX(null);
    setTouchEndY(null);
    setTouchStartX(e.targetTouches[0].clientX);
    setTouchStartY(e.targetTouches[0].clientY);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEndX(e.targetTouches[0].clientX);
    setTouchEndY(e.targetTouches[0].clientY);
  };

  const onTouchEnd = () => {
    if (!touchStartX || !touchStartY || !touchEndX || !touchEndY) return;
    
    const distanceX = touchStartX - touchEndX;
    const distanceY = touchStartY - touchEndY;
    const isHorizontalSwipe = Math.abs(distanceX) > Math.abs(distanceY);
    const isVerticalSwipe = !isHorizontalSwipe;

    if (isHorizontalSwipe && Math.abs(distanceX) > minSwipeDistance) {
      // Swipe left = next, swipe right = previous
      if (distanceX > 0) {
        handleNext();
      } else {
        handlePrevious();
      }
    } else if (isVerticalSwipe && Math.abs(distanceY) > minSwipeDistance) {
      // Swipe down to close
      if (distanceY < 0) {
        onClose();
      }
    }
  };

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  const currentImage = images[currentIndex];
  const imageUrl = currentImage?.image_url || leadImageUrl;

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#000',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: 'var(--space-3)',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
          zIndex: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div style={{ color: '#fff', fontSize: '10pt' }}>
          {currentIndex + 1} / {images.length}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: '24px',
            cursor: 'pointer',
            padding: 'var(--space-2)',
            minWidth: '44px',
            minHeight: '44px'
          }}
        >
          ×
        </button>
      </div>

      {/* Main Image */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <img
          src={imageUrl}
          alt={currentImage?.caption || 'Vehicle image'}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain'
          }}
        />

        {/* Navigation Arrows */}
        {images.length > 1 && (
          <>
            <button
              onClick={handlePrevious}
              style={{
                position: 'absolute',
                left: 'var(--space-3)',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(0,0,0,0.5)',
                border: 'none',
                color: '#fff',
                fontSize: '24px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ‹
            </button>
            <button
              onClick={handleNext}
              style={{
                position: 'absolute',
                right: 'var(--space-3)',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(0,0,0,0.5)',
                border: 'none',
                color: '#fff',
                fontSize: '24px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* Image Info Footer */}
      {currentImage && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: 'var(--space-4)',
            background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
            color: '#fff'
          }}
        >
          {currentImage.angle_tag && (
            <div style={{ fontSize: '8pt', color: '#aaa', marginBottom: 'var(--space-1)' }}>
              {currentImage.angle_tag}
            </div>
          )}
          {currentImage.caption && (
            <div style={{ fontSize: '9pt' }}>
              {currentImage.caption}
            </div>
          )}
          <div style={{ fontSize: '7pt', color: '#888', marginTop: 'var(--space-2)' }}>
            {new Date(currentImage.created_at).toLocaleDateString()}
          </div>
          <div
            style={{
              marginTop: 'var(--space-3)',
              textAlign: 'center',
              fontSize: '8pt',
              color: '#aaa'
            }}
          >
            Swipe down to close • Swipe left/right to navigate
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileImageGallery;

