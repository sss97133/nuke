/**
 * Favicon Icon Component
 * Fetches and displays favicons from URLs (like browser search bars)
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
}

export const FaviconIcon: React.FC<FaviconIconProps> = ({
  url,
  size = 16,
  className = '',
  style = {},
  matchTextSize = false,
  textSize = 8
}) => {
  // If matching text size, calculate icon size from font size
  const iconSize = matchTextSize ? Math.round(textSize * 1.2) : size; // Slightly larger than text for visibility
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) return;

    try {
      // Extract domain from URL
      const domain = new URL(url).hostname;
      
      // Try multiple favicon services (fallback chain)
      const faviconServices = [
        // Google's favicon service (most reliable)
        `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`,
        // Icon Horse (alternative)
        `https://icon.horse/icon/${domain}`,
        // Direct favicon.ico
        `https://${domain}/favicon.ico`,
        // Fallback to domain root
        `https://${domain}/favicon.png`
      ];

      // Try first service (Google's is most reliable)
      setFaviconUrl(faviconServices[0]);
      setError(false);
    } catch (err) {
      setError(true);
    }
  }, [url, size]);

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
          width: `${iconSize}px`,
          height: `${iconSize}px`,
          display: 'inline-block',
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

