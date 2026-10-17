/**
 * Organization Logo Component
 * Draws the organization's recorded logo (logo_url), else its type icon. It does not guess a logo from the
 * website: Clearbit's logo API no longer resolves (218 failed lookups on /org, 2026-10-14) and Google's favicon
 * service 404'd for 58 more, and a favicon fetched by domain is not attributed identity artwork.
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
  /** The widest a 'logo' variant may draw, in pixels (default three times its height): a wide wordmark needs more. */
  maxWidth?: number;
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

export const OrgLogo: React.FC<OrgLogoProps> = ({
  logoUrl,
  businessType,
  businessName = '',
  size = 24,
  maxWidth,
  variant = 'icon',
  className = '',
  style = {},
}) => {
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [fallbackLevel, setFallbackLevel] = useState(0);
  // 0 = logoUrl, 3 = icon fallback

  const colors = typeColors[businessType || ''] || defaultColors;
  const IconComponent = typeIcons[businessType || ''] || DefaultIcon;

  useEffect(() => {
    const normalized = logoUrl
      ? logoUrl.replace(/^https:\/\/nuke\.ag\/source-logos\//, '/source-logos/')
      : null;
    setFallbackLevel(normalized ? 0 : 3);
    setCurrentSrc(normalized);
  }, [logoUrl]);

  // The recorded logo failed to load: draw the type icon instead of a broken image
  const handleError = () => {
    setFallbackLevel(3);
    setCurrentSrc(null);
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
              maxWidth: '160px',
              maxHeight: '88px',
              objectFit: 'contain',
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.94)',
              border: '1px solid rgba(0, 0, 0, 0.08)',
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
            maxWidth: `${maxWidth ?? size * 3}px`,
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
