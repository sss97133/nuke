import React from 'react';

interface CircularAvatarProps {
  src?: string | null;
  alt?: string;
  size?: number;
  fallback?: string | React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Reusable circular avatar component that properly crops images to fit circle
 * Use this sitewide for all circular avatar/logo displays
 */
export const CircularAvatar: React.FC<CircularAvatarProps> = ({
  src,
  alt = '',
  size = 22,
  fallback,
  style = {},
  className = ''
}) => {
  return (
    <div
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        borderRadius: '50%',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        overflow: 'hidden',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...style
      }}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
            display: 'block'
          }}
        />
      ) : fallback ? (
        typeof fallback === 'string' ? (
          <span style={{ fontSize: `${size * 0.5}px`, fontWeight: 600 }}>
            {fallback.charAt(0).toUpperCase()}
          </span>
        ) : (
          fallback
        )
      ) : null}
    </div>
  );
};

