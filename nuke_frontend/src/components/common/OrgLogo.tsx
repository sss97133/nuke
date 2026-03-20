/**
 * Organization Logo Component
 * Auto-fetches logos from websites using Clearbit/Google APIs
 * with type-based fallbacks for organizations without websites.
 */

import React, { useState, useEffect } from 'react';
import {
  Building2,
  Store,
  Gavel,
  Folder,
  Wrench,
  Factory,
  Car,
  Users
} from 'lucide-react';

interface OrgLogoProps {
  website?: string | null;
  logoUrl?: string | null;
  businessType?: string | null;
  businessName?: string;
  size?: number;
  variant?: 'icon' | 'logo' | 'card';
  className?: string;
  style?: React.CSSProperties;
}

// Type-based color palettes
const typeColors: Record<string, { bg: string; icon: string; gradient: string }> = {
  auction_house: {
    bg: 'var(--error-dim)',
    icon: 'var(--error)',
    gradient: '#7f1d1d'
  },
  dealership: {
    bg: 'var(--info-dim)',
    icon: 'var(--info)',
    gradient: '#1e3a5f'
  },
  collection: {
    bg: 'rgba(168, 85, 247, 0.15)',
    icon: 'var(--purple)',
    gradient: '#4c1d95'
  },
  manufacturer: {
    bg: 'var(--success-dim)',
    icon: 'var(--success)',
    gradient: '#14532d'
  },
  service_shop: {
    bg: 'var(--warning-dim)',
    icon: 'var(--warning)',
    gradient: '#78350f'
  },
  museum: {
    bg: 'rgba(236, 72, 153, 0.15)',
    icon: '#ec4899',
    gradient: '#831843'
  },
  club: {
    bg: 'var(--info-dim)',
    icon: 'var(--info)',
    gradient: '#0c4a6e'
  },
};

const defaultColors = {
  bg: 'var(--accent-dim)',
  icon: 'var(--text-secondary)',
  gradient: 'var(--surface)'
};

// Type-based icons
const typeIcons: Record<string, React.FC<{ size: number; color: string }>> = {
  auction_house: ({ size, color }) => <Gavel size={size} color={color} />,
  dealership: ({ size, color }) => <Store size={size} color={color} />,
  collection: ({ size, color }) => <Folder size={size} color={color} />,
  manufacturer: ({ size, color }) => <Factory size={size} color={color} />,
  service_shop: ({ size, color }) => <Wrench size={size} color={color} />,
  museum: ({ size, color }) => <Building2 size={size} color={color} />,
  club: ({ size, color }) => <Users size={size} color={color} />,
};

const DefaultIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <Car size={size} color={color} />
);

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export const OrgLogo: React.FC<OrgLogoProps> = ({
  website,
  logoUrl,
  businessType,
  businessName = '',
  size = 24,
  variant = 'icon',
  className = '',
  style = {},
}) => {
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [fallbackLevel, setFallbackLevel] = useState(0);
  // 0 = logoUrl, 1 = clearbit, 2 = google favicon, 3 = icon fallback

  const colors = typeColors[businessType || ''] || defaultColors;
  const IconComponent = typeIcons[businessType || ''] || DefaultIcon;

  useEffect(() => {
    setFallbackLevel(0);

    if (logoUrl) {
      setCurrentSrc(logoUrl);
      return;
    }

    const domain = website ? extractDomain(website) : null;
    if (domain) {
      // Start with Clearbit for higher quality
      setCurrentSrc(`https://logo.clearbit.com/${domain}`);
      setFallbackLevel(1);
    } else {
      setFallbackLevel(3);
      setCurrentSrc(null);
    }
  }, [logoUrl, website]);

  const handleError = () => {
    const domain = website ? extractDomain(website) : null;

    if (fallbackLevel === 0 && logoUrl) {
      // logoUrl failed, try clearbit
      if (domain) {
        setCurrentSrc(`https://logo.clearbit.com/${domain}`);
        setFallbackLevel(1);
      } else {
        setFallbackLevel(3);
        setCurrentSrc(null);
      }
    } else if (fallbackLevel === 1 && domain) {
      // Clearbit failed, try Google favicon
      setCurrentSrc(`https://www.google.com/s2/favicons?domain=${domain}&sz=${Math.max(size, 64)}`);
      setFallbackLevel(2);
    } else {
      // All image sources failed
      setFallbackLevel(3);
      setCurrentSrc(null);
    }
  };

  // Card variant - for the 240px image area
  if (variant === 'card') {
    if (currentSrc && fallbackLevel < 3) {
      return (
        <div
          className={className}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.gradient,
            ...style,
          }}
        >
          <img
            src={currentSrc}
            alt=""
            style={{
              maxWidth: fallbackLevel === 2 ? '48px' : '180px',
              maxHeight: fallbackLevel === 2 ? '48px' : '100px',
              objectFit: 'contain',
              filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.3))',
            }}
            onError={handleError}
          />
        </div>
      );
    }

    // Icon fallback for card
    return (
      <div
        className={className}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: colors.gradient,
          ...style,
        }}
      >
        <div style={{
          opacity: 0.6,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px'
        }}>
          <IconComponent size={48} color={colors.icon} />
          {businessName && (
            <span style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'rgba(255,255,255,0.5)',
              textAlign: 'center',
              maxWidth: '200px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {businessName}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Logo variant - larger, for prominent display
  if (variant === 'logo') {
    if (currentSrc && fallbackLevel < 3) {
      return (
        <img
          src={currentSrc}
          alt=""
          className={className}
          style={{
            height: `${size}px`,
            maxWidth: `${size * 3}px`,
            objectFit: 'contain',
            display: 'block',
            ...style,
          }}
          onError={handleError}
        />
      );
    }

    // Icon fallback for logo
    return (
      <div
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: colors.bg, ...style,
        }}
      >
        <IconComponent size={size * 0.6} color={colors.icon} />
      </div>
    );
  }

  // Icon variant (default) - small inline icon
  if (currentSrc && fallbackLevel < 3) {
    return (
      <img
        src={currentSrc}
        alt=""
        className={className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          objectFit: 'contain', display: 'block',
          ...style,
        }}
        onError={handleError}
      />
    );
  }

  // Icon fallback
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: colors.bg, ...style,
      }}
    >
      <IconComponent size={size * 0.6} color={colors.icon} />
    </div>
  );
};

export { typeColors, typeIcons };
