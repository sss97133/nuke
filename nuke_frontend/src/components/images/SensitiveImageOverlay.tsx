/**
 * Sensitive Image Overlay
 * Blurs and restricts access to sensitive images (titles, registrations, etc.)
 * Only visible to authorized users: owner, uploader, associated organizations
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface SensitiveImageOverlayProps {
  imageId: string;
  vehicleId: string;
  imageUrl: string;
  isSensitive: boolean;
  sensitiveType?: string;
  onRequestAccess?: () => void;
}

export const SensitiveImageOverlay: React.FC<SensitiveImageOverlayProps> = ({
  imageId,
  vehicleId,
  imageUrl,
  isSensitive,
  sensitiveType,
  onRequestAccess
}) => {
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    // Only do access checks for sensitive content. (Fallback/external images use synthetic ids like "ext_0"
    // which are not UUIDs and will 400 if we query `vehicle_images.id`.)
    if (!isSensitive) {
      setHasAccess(true);
      setLoading(false);
      return;
    }
    if (!isUuid(String(imageId || ''))) {
      setHasAccess(false);
      setLoading(false);
      return;
    }
    checkAccess();
  }, [imageId, vehicleId, isSensitive]);

  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const checkAccess = async () => {
    setLoading(true);
    
    // Get current session
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);

    if (!session) {
      setHasAccess(false);
      setLoading(false);
      return;
    }

    try {
      // Check if user has access to this image
      // The RLS policies will automatically filter this
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id')
        .eq('id', imageId)
        .single();

      // If we can read the image, we have access
      setHasAccess(!error && data !== null);
    } catch (error) {
      console.error('Error checking image access:', error);
      setHasAccess(false);
    } finally {
      setLoading(false);
    }
  };

  // If not sensitive, show image normally
  if (!isSensitive) {
    return (
      <img 
        src={imageUrl} 
        alt="Vehicle image"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => {
          // Image load error handled silently
        }}
      />
    );
  }

  // If sensitive and has access, show with warning banner
  if (hasAccess && !loading) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <img 
          src={imageUrl} 
          alt="Sensitive document"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => {
            // Image load error handled silently
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            backgroundColor: 'rgba(220, 38, 38, 0.9)',
            color: 'white',
            padding: 'var(--space-2)',
            fontSize: '8pt',
            fontWeight: 700,
            textAlign: 'center',
            borderBottom: '2px solid var(--border)'
          }}
        >
          SENSITIVE: {sensitiveType?.toUpperCase() || 'DOCUMENT'} - RESTRICTED ACCESS
        </div>
      </div>
    );
  }

  // If sensitive and NO access, show blurred with restriction message
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--grey-100)',
        padding: 'var(--space-4)'
      }}
    >
      {/* Heavily blurred background */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(50px)',
          opacity: 0.3
        }}
      />

      {/* Restriction message */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
          maxWidth: '400px'
        }}
      >
        <div
          style={{
            padding: 'var(--space-4)',
            backgroundColor: 'var(--white)',
            border: '2px solid var(--border)',
            marginBottom: 'var(--space-3)'
          }}
        >
          <div
            style={{
              fontSize: '24px',
              marginBottom: 'var(--space-2)',
              fontWeight: 700
            }}
          >
            RESTRICTED ACCESS
          </div>
          <p style={{ fontSize: '9pt', marginBottom: 'var(--space-2)' }}>
            This image contains sensitive information ({sensitiveType || 'document'})
          </p>
          <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Access limited to: Vehicle owner, uploader, and associated organizations
          </p>
        </div>

        {!session && (
          <button
            onClick={() => window.location.href = '/login'}
            className="button button-primary"
            style={{ fontSize: '9pt' }}
          >
            Sign In to Request Access
          </button>
        )}

        {session && onRequestAccess && (
          <button
            onClick={onRequestAccess}
            className="button button-primary"
            style={{ fontSize: '9pt' }}
          >
            Request Access
          </button>
        )}
      </div>
    </div>
  );
};

