/**
 * Favicon Icon Component
 * Fetches and displays favicons from URLs (like browser search bars)
 * Checks database cache first, then falls back to external services
 */

import React, { useState, useEffect } from 'react';
import { getCachedFavicon, extractAndCacheFavicon, detectSourceType } from '../../services/sourceFaviconService';

interface FaviconIconProps {
  url: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  // For text-adjacent icons (matches font size)
  matchTextSize?: boolean;
  textSize?: number; // Font size in pt (e.g., 8pt)
  /**
   * Render at a fixed height (size) while allowing the image to keep its natural aspect ratio.
   * Useful for rectangular favicons/logos so they don't look cropped or collide with text.
   */
  preserveAspectRatio?: boolean;
  /**
   * Only used when preserveAspectRatio is true. Caps how wide the image can be.
   * Defaults to 2x the computed icon size.
   */
  maxWidth?: number;
}

export const FaviconIcon: React.FC<FaviconIconProps> = ({
  url,
  size = 16,
  className = '',
  style = {},
  matchTextSize = false,
  textSize = 8,
  preserveAspectRatio = false,
  maxWidth
}) => {
  // If matching text size, calculate icon size from font size
  const iconSize = matchTextSize ? Math.round(textSize * 1.2) : size; // Slightly larger than text for visibility
  const effectiveMaxWidth = maxWidth ?? iconSize * 2;
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;

    // First, try to get from database cache
    getCachedFavicon(url).then((cachedUrl) => {
      if (cancelled) return;
      
      if (cachedUrl) {
        setFaviconUrl(cachedUrl);
        setError(false);
      } else {
        // Not in cache, extract and cache it
        const sourceInfo = detectSourceType(url);
        extractAndCacheFavicon(
          url,
          sourceInfo?.type,
          sourceInfo?.name
        ).then((extractedUrl) => {
          if (cancelled) return;
          
          if (extractedUrl) {
            setFaviconUrl(extractedUrl);
            setError(false);
          } else {
            // Fallback to direct extraction
            try {
              const domain = new URL(url).hostname;
              const fallbackUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=${iconSize}`;
              setFaviconUrl(fallbackUrl);
              setError(false);
            } catch (err) {
              setError(true);
            }
          }
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [url, iconSize]);

  if (error || !faviconUrl) {
      // Fallback: show first letter of domain
      try {
        const domain = new URL(url).hostname;
        const letter = domain.charAt(0).toUpperCase();
        return (
          <span
            className={className}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: `${iconSize}px`,
              height: `${iconSize}px`,
              backgroundColor: 'rgba(255,255,255,0.1)',
              color: '#fff',
              fontSize: `${iconSize * 0.6}px`,
              fontWeight: 'bold',
              borderRadius: '2px',
              ...style
            }}
          >
            {letter}
          </span>
        );
      } catch {
        return null;
      }
    }

    return (
      <img
        src={faviconUrl}
        alt=""
        className={className}
        style={{
          width: preserveAspectRatio ? 'auto' : `${iconSize}px`,
          height: `${iconSize}px`,
          maxWidth: preserveAspectRatio ? `${effectiveMaxWidth}px` : undefined,
          objectFit: preserveAspectRatio ? 'contain' : undefined,
          display: 'block',
          verticalAlign: 'middle',
          marginRight: matchTextSize ? '3px' : '4px',
          ...style
        }}
        onError={() => {
          // Try next fallback
          try {
            const domain = new URL(url).hostname;
            setFaviconUrl(`https://icon.horse/icon/${domain}`);
          } catch {
            setError(true);
          }
        }}
      />
    );
};

