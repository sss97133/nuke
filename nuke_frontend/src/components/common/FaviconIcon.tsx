/**
 * Favicon Icon Component
 * Fetches and displays favicons from URLs (like browser search bars).
 *
 * NOTE: This component intentionally uses ONLY Google's S2 favicon endpoint.
 * We do not use other favicon providers or cached/extracted icons.
 */

import React, { useState, useEffect } from 'react';

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
  /**
   * Render favicon inside a circular badge container.
   * The favicon is centered within the circle.
   */
  circleBadge?: boolean;
  /**
   * Background color for the circle badge.
   * Defaults to semi-transparent dark.
   */
  circleBadgeBg?: string;
}

export const FaviconIcon: React.FC<FaviconIconProps> = ({
  url,
  size = 16,
  className = '',
  style = {},
  matchTextSize = false,
  textSize = 8,
  preserveAspectRatio = false,
  maxWidth,
  circleBadge = false,
  circleBadgeBg = 'rgba(0,0,0,0.75)'
}) => {
  // If matching text size, calculate icon size from font size
  const iconSize = matchTextSize ? Math.round(textSize * 1.2) : size; // Slightly larger than text for visibility
  const effectiveMaxWidth = maxWidth ?? iconSize * 2;
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) return;
    try {
      const domain = new URL(url).hostname;
      setFaviconUrl(`https://www.google.com/s2/favicons?domain=${domain}&sz=${iconSize}`);
      setError(false);
    } catch {
      setFaviconUrl(null);
      setError(true);
    }
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

    const imgElement = (
      <img
        src={faviconUrl}
        alt=""
        className={circleBadge ? '' : className}
        style={circleBadge ? {
          width: `${Math.round(iconSize * 0.7)}px`,
          height: `${Math.round(iconSize * 0.7)}px`,
          objectFit: 'contain',
          display: 'block',
        } : {
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
          setError(true);
        }}
      />
    );

    if (circleBadge) {
      // Circle badge: favicon is centered inside a circle
      const badgeSize = iconSize * 1.6; // Badge is larger than favicon to provide padding
      return (
        <div
          className={className}
          style={{
            width: `${badgeSize}px`,
            height: `${badgeSize}px`,
            borderRadius: '50%',
            background: circleBadgeBg,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            ...style
          }}
        >
          {imgElement}
        </div>
      );
    }

    return imgElement;
};

