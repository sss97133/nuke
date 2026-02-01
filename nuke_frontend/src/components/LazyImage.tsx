import React, { useState, useEffect, useRef } from 'react';
import { optimizeImageUrl, type ImageSize } from '../lib/imageOptimizer';

interface LazyImageProps {
  src: string;
  thumbnailUrl?: string;
  mediumUrl?: string;
  largeUrl?: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  size?: 'thumbnail' | 'medium' | 'large' | 'full';
  onClick?: () => void;
  eager?: boolean; // Load immediately without lazy loading
}

const LazyImage: React.FC<LazyImageProps> = ({
  src,
  thumbnailUrl,
  mediumUrl,
  largeUrl,
  alt = '',
  className = '',
  style = {},
  size = 'medium',
  onClick,
  eager = false
}) => {
  const [loaded, setLoaded] = useState(false);
  const [isInView, setIsInView] = useState(eager);
  const [currentSrc, setCurrentSrc] = useState<string>('');
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine which URL to use based on size and availability
  const getOptimalUrl = (): string => {
    // Use pre-generated URLs if available
    if (size === 'thumbnail' && thumbnailUrl) return thumbnailUrl;
    if (size === 'medium' && mediumUrl) return mediumUrl;
    if (size === 'large' && largeUrl) return largeUrl;

    // Otherwise, optimize the source URL dynamically
    const sizeMap: Record<string, ImageSize> = {
      'thumbnail': 'thumbnail',
      'medium': 'medium',
      'large': 'large',
      'full': 'full'
    };
    return optimizeImageUrl(src, sizeMap[size] || 'medium') || src;
  };

  // Set up Intersection Observer
  useEffect(() => {
    if (eager) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '50px', // Start loading 50px before coming into view
        threshold: 0.01
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [eager]);

  // Load image when in view
  useEffect(() => {
    if (isInView && !loaded) {
      const url = getOptimalUrl();
      
      // Preload image
      const img = new Image();
      img.onload = () => {
        setCurrentSrc(url);
        setLoaded(true);
      };
      img.onerror = () => {
        // Fallback to original if optimized version fails
        setCurrentSrc(src);
        setLoaded(true);
      };
      img.src = url;
    }
  }, [isInView, loaded, src, thumbnailUrl, mediumUrl, largeUrl, size]);

  // Progressive enhancement: load higher quality on hover
  const handleMouseEnter = () => {
    if (loaded && size === 'thumbnail' && mediumUrl) {
      // Preload medium size for smoother transition
      const img = new Image();
      img.src = mediumUrl;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`lazy-image-container ${className}`}
      style={{
        position: 'relative',
        backgroundColor: 'var(--bg)',
        ...style
      }}
      onMouseEnter={handleMouseEnter}
      onClick={onClick}
    >
      {/* Placeholder */}
      {!loaded && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--bg)',
            borderRadius: 'inherit'
          }}
        >
          {/* Shimmer effect */}
          <div
            className="shimmer"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
              animation: 'shimmer 1.5s infinite',
              borderRadius: 'inherit'
            }}
          />
          {/* Loading icon */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ opacity: 0.3 }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}

      {/* Actual image */}
      {currentSrc && (
        <img
          ref={imageRef}
          src={currentSrc}
          alt={alt}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.3s ease-in-out',
            borderRadius: 'inherit',
            cursor: onClick ? 'pointer' : 'default'
          }}
        />
      )}

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default LazyImage;
