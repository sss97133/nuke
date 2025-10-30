/**
 * Mobile Hero Carousel - Enhanced Touch Gestures
 * Smooth swipe transitions for hero vehicle carousel
 */

import React, { useState, useRef, useEffect } from 'react';

interface HeroVehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  current_value?: number;
  roi_pct?: number;
  image_count?: number;
  event_count?: number;
  view_count?: number;
  activity_7d?: number;
  primary_image_url?: string;
  hype_reason?: string;
}

interface MobileHeroCarouselProps {
  vehicles: HeroVehicle[];
  onNavigate: (vehicleId: string) => void;
  onDataClick: (type: 'year' | 'make' | 'model', value: string | number) => void;
}

export const MobileHeroCarousel: React.FC<MobileHeroCarouselProps> = ({
  vehicles,
  onNavigate,
  onDataClick
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const minSwipeDistance = 50;

  useEffect(() => {
    // Auto-advance every 5 seconds if not interacting
    const timer = setInterval(() => {
      if (!touchStart && vehicles.length > 1) {
        handleNext();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [currentIndex, touchStart, vehicles.length]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
    return `$${value.toLocaleString()}`;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart) return;
    const currentTouch = e.targetTouches[0].clientX;
    const diff = touchStart - currentTouch;
    setSwipeOffset(-diff);
    setTouchEnd(currentTouch);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && currentIndex < vehicles.length - 1) {
      handleNext();
      // Haptic feedback
      if (navigator.vibrate) navigator.vibrate(20);
    } else if (isRightSwipe && currentIndex > 0) {
      handlePrevious();
      if (navigator.vibrate) navigator.vibrate(20);
    }

    // Reset
    setTouchStart(null);
    setTouchEnd(null);
    setSwipeOffset(0);
  };

  const handleNext = () => {
    if (currentIndex < vehicles.length - 1 && !isTransitioning) {
      setIsTransitioning(true);
      setCurrentIndex(currentIndex + 1);
      setTimeout(() => setIsTransitioning(false), 300);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0 && !isTransitioning) {
      setIsTransitioning(true);
      setCurrentIndex(currentIndex - 1);
      setTimeout(() => setIsTransitioning(false), 300);
    }
  };

  if (vehicles.length === 0) return null;

  const currentVehicle = vehicles[currentIndex];

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        height: '400px',
        overflow: 'hidden',
        touchAction: 'pan-y',
        userSelect: 'none'
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Vehicle Cards - Stacked with Transform */}
      <div
        style={{
          display: 'flex',
          height: '100%',
          transform: `translateX(calc(-${currentIndex * 100}% + ${swipeOffset}px))`,
          transition: swipeOffset === 0 ? 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
          willChange: 'transform'
        }}
      >
        {vehicles.map((vehicle, idx) => (
          <div
            key={vehicle.id}
            style={{
              minWidth: '100%',
              height: '100%',
              position: 'relative',
              background: vehicle.primary_image_url
                ? `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url(${vehicle.primary_image_url})`
                : 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '16px'
            }}
            onClick={() => idx === currentIndex && onNavigate(vehicle.id)}
          >
            {/* Hype Badge */}
            {vehicle.hype_reason && (
              <div style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                background: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(8px)',
                color: '#ffffff',
                padding: '4px 10px',
                fontSize: '9pt',
                fontWeight: '600',
                borderRadius: '4px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                letterSpacing: '0.5px'
              }}>
                {vehicle.hype_reason}
              </div>
            )}

            {/* Pagination Dots */}
            {vehicles.length > 1 && idx === currentIndex && (
              <div style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                display: 'flex',
                gap: '6px'
              }}>
                {vehicles.map((_, dotIdx) => (
                  <div
                    key={dotIdx}
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: dotIdx === currentIndex ? '#ffffff' : 'rgba(255,255,255,0.4)',
                      transition: 'all 0.3s',
                      border: '1px solid rgba(255, 255, 255, 0.5)'
                    }}
                  />
                ))}
              </div>
            )}

            {/* Vehicle Info */}
            {idx === currentIndex && (
              <div style={{ maxWidth: '100%' }}>
                <div style={{
                  fontSize: '20pt',
                  fontWeight: '600',
                  color: '#ffffff',
                  textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
                  marginBottom: '8px',
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap'
                }}>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onDataClick('year', vehicle.year || 0);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {vehicle.year}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onDataClick('make', vehicle.make || '');
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {vehicle.make}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onDataClick('model', vehicle.model || '');
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {vehicle.model}
                  </span>
                </div>

                <div style={{
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <div style={{
                    fontSize: '18pt',
                    fontWeight: '700',
                    color: '#ffffff',
                    textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
                    fontFamily: 'monospace'
                  }}>
                    {formatCurrency(vehicle.current_value || 0)}
                  </div>

                  {vehicle.roi_pct !== undefined && vehicle.roi_pct !== 0 && (
                    <div style={{
                      fontSize: '14pt',
                      fontWeight: '700',
                      color: vehicle.roi_pct >= 0 ? '#4ade80' : '#f87171',
                      textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
                      background: 'rgba(0, 0, 0, 0.3)',
                      padding: '3px 6px',
                      borderRadius: '4px'
                    }}>
                      {vehicle.roi_pct >= 0 ? '↑' : '↓'} {Math.abs(vehicle.roi_pct).toFixed(0)}%
                    </div>
                  )}
                </div>

                <div style={{
                  display: 'flex',
                  gap: '12px',
                  fontSize: '8pt',
                  color: 'rgba(255, 255, 255, 0.9)',
                  textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                  fontWeight: '500'
                }}>
                  <span>{vehicle.image_count} photos</span>
                  <span>{vehicle.event_count} events</span>
                  <span>{vehicle.view_count || 0} views</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Swipe Indicators */}
      {currentIndex > 0 && (
        <div style={{
          position: 'absolute',
          left: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: '32pt',
          pointerEvents: 'none'
        }}>
          ‹
        </div>
      )}
      {currentIndex < vehicles.length - 1 && (
        <div style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: '32pt',
          pointerEvents: 'none'
        }}>
          ›
        </div>
      )}
    </div>
  );
};

