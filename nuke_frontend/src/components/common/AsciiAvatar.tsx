/**
 * ASCII Art Avatar Component
 * Generates identity-based decorative avatars for users without profile images
 */

import React, { useState, useEffect } from 'react';
import { generateIdentityBasedAvatar, getMonogramFromIdentity, type UserIdentity } from '../../utils/identityBasedAvatar';
import { supabase } from '../../lib/supabase';

interface AsciiAvatarProps {
  seed: string; // Username, user ID, or any string to generate unique avatar
  platform?: 'bat' | 'nzero'; // Platform for identity lookup
  userId?: string; // User ID for N-Zero profiles
  size?: number; // Size in pixels
  style?: React.CSSProperties;
  onError?: () => void;
}

export const AsciiAvatar: React.FC<AsciiAvatarProps> = ({
  seed,
  platform,
  userId,
  size = 24,
  style = {},
  onError
}) => {
  const [asciiArt, setAsciiArt] = React.useState<string>('');
  const [monogram, setMonogram] = React.useState<string>('');
  const [identity, setIdentity] = React.useState<UserIdentity | null>(null);
  
  useEffect(() => {
    const loadAvatar = async () => {
      try {
        const pattern = await generateIdentityBasedAvatar(seed, platform, userId);
        setAsciiArt(pattern);
        
        // Load identity for monogram
        const userIdentity: UserIdentity = {
          username: seed
        };
        
        if (platform === 'bat') {
          const { data: extIdentity } = await supabase
            .from('external_identities')
            .select('handle, metadata')
            .eq('platform', 'bat')
            .eq('handle', seed)
            .maybeSingle();
          
          if (extIdentity?.metadata) {
            userIdentity.comment_analysis = extIdentity.metadata.comment_analysis;
            userIdentity.username_parts = extIdentity.metadata.comment_analysis?.username_parts;
          }
        }
        
        setIdentity(userIdentity);
        setMonogram(getMonogramFromIdentity(userIdentity));
      } catch (e) {
        // Fallback to simple pattern
        const { generateFirecrawlStyleAvatar, generateMonogramAvatar } = await import('../../utils/asciiAvatar');
        setAsciiArt(generateFirecrawlStyleAvatar(seed));
        setMonogram(generateMonogramAvatar(seed));
      }
    };
    
    loadAvatar();
  }, [seed, platform, userId]);
  
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
        ...style
      }}
      title={seed}
    >
      {/* ASCII art background (Firecrawl style) */}
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          fontSize: '2px',
          lineHeight: '2px',
          color: 'var(--text-muted)',
          opacity: 0.4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          whiteSpace: 'pre',
          textAlign: 'center',
          transform: 'scale(0.7)',
          userSelect: 'none',
          pointerEvents: 'none'
        }}
        className="text-heat-100 font-mono"
      >
        {asciiArt}
      </div>
      
      {/* Monogram overlay (more visible) */}
      <div
        style={{
          position: 'absolute',
          fontSize: `${size * 0.35}px`,
          fontWeight: 800,
          color: 'var(--text)',
          zIndex: 1,
          textShadow: '0 1px 2px rgba(0,0,0,0.1)',
          userSelect: 'none',
          pointerEvents: 'none'
        }}
      >
        {monogram}
      </div>
    </div>
  );
};

/**
 * Fallback avatar that shows ASCII art when image fails to load
 */
interface FallbackAvatarProps {
  src?: string | null;
  seed: string;
  platform?: 'bat' | 'nzero';
  userId?: string;
  size?: number;
  alt?: string;
  style?: React.CSSProperties;
}

export const FallbackAvatar: React.FC<FallbackAvatarProps> = ({
  src,
  seed,
  platform,
  userId,
  size = 24,
  alt = '',
  style = {}
}) => {
  const [imageError, setImageError] = React.useState(false);
  const [imageLoaded, setImageLoaded] = React.useState(false);
  
  // If no src or image errored, show ASCII avatar
  if (!src || imageError) {
    return <AsciiAvatar seed={seed} platform={platform} userId={userId} size={size} style={style} />;
  }
  
  return (
    <img
      src={src}
      alt={alt}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1px solid var(--border)',
        objectFit: 'cover',
        display: imageLoaded ? 'block' : 'none',
        ...style
      }}
      onError={() => {
        setImageError(true);
      }}
      onLoad={() => {
        setImageLoaded(true);
      }}
    />
  );
};

