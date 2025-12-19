/**
 * IDHoverCard - Automatically detects UUIDs/IDs and shows relevant data on hover
 * Works with: image IDs, vehicle IDs, user IDs, document IDs, etc.
 */

import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { ImageHoverPreview } from './ImageHoverPreview';

interface IDHoverCardProps {
  id: string;
  type?: 'auto' | 'image' | 'vehicle' | 'user' | 'document';
  children: React.ReactNode;
  className?: string;
}

interface VehicleData {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  created_at?: string;
}

interface ImageData {
  id: string;
  image_url: string;
  medium_url?: string;
  large_url?: string;
  created_at: string;
  extracted_at?: string;
  vehicle_id?: string;
  ai_scan_metadata?: any;
}

interface UserData {
  id: string;
  email?: string;
  full_name?: string;
  created_at?: string;
}

// UUID regex pattern
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID_PATTERN = /^[0-9a-f]{8,32}$/i;

export const IDHoverCard: React.FC<IDHoverCardProps> = ({
  id,
  type = 'auto',
  children,
  className = ''
}) => {
  const [showCard, setShowCard] = useState(false);
  const [data, setData] = useState<VehicleData | ImageData | UserData | null>(null);
  const [loading, setLoading] = useState(false);
  const [cardPosition, setCardPosition] = useState({ top: 0, left: 0 });
  const [detectedType, setDetectedType] = useState<'image' | 'vehicle' | 'user' | 'document' | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Detect ID type if auto
  useEffect(() => {
    if (type === 'auto' && id) {
      // Try to detect from context or ID pattern
      // For now, we'll try to load and see what we get
      setDetectedType(null);
    } else {
      setDetectedType(type as 'image' | 'vehicle' | 'user' | 'document');
    }
  }, [id, type]);

  const loadData = async () => {
    if (data) return; // Already loaded
    if (!id || (!UUID_PATTERN.test(id) && !SHORT_ID_PATTERN.test(id))) return;

    setLoading(true);
    try {
      const actualType = detectedType || type;

      // Try image first (most common in admin pages)
      if (actualType === 'auto' || actualType === 'image') {
        const { data: img, error: imgError } = await supabase
          .from('vehicle_images')
          .select('id, image_url, medium_url, large_url, created_at, vehicle_id, ai_scan_metadata')
          .eq('id', id)
          .maybeSingle();

        if (!imgError && img) {
          let extractedAt: string | undefined;
          if (img.ai_scan_metadata) {
            const meta = img.ai_scan_metadata;
            if (meta.extractions) {
              const extractionDates = Object.values(meta.extractions)
                .map((ext: any) => ext.extracted_at)
                .filter(Boolean)
                .sort()
                .reverse();
              extractedAt = extractionDates[0];
            } else if (meta.appraiser?.extracted_at) {
              extractedAt = meta.appraiser.extracted_at;
            } else if (meta.last_extracted_at) {
              extractedAt = meta.last_extracted_at;
            }
          }

          setData({
            id: img.id,
            image_url: img.image_url,
            medium_url: img.medium_url,
            large_url: img.large_url,
            created_at: img.created_at,
            extracted_at: extractedAt,
            vehicle_id: img.vehicle_id,
            ai_scan_metadata: img.ai_scan_metadata
          } as ImageData);
          setDetectedType('image');
          setLoading(false);
          return;
        }
      }

      // Try vehicle
      if (actualType === 'auto' || actualType === 'vehicle') {
        const { data: vehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .select('id, year, make, model, vin, created_at')
          .eq('id', id)
          .maybeSingle();

        if (!vehicleError && vehicle) {
          setData(vehicle as VehicleData);
          setDetectedType('vehicle');
          setLoading(false);
          return;
        }
      }

      // Try user/profile
      if (actualType === 'auto' || actualType === 'user') {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, email, full_name, created_at')
          .eq('id', id)
          .maybeSingle();

        if (!profileError && profile) {
          setData(profile as UserData);
          setDetectedType('user');
          setLoading(false);
          return;
        }
      }

      // Try secure_documents
      if (actualType === 'auto' || actualType === 'document') {
        const { data: doc, error: docError } = await supabase
          .from('secure_documents')
          .select('id, document_type, vehicle_id, user_id, created_at, storage_path')
          .eq('id', id)
          .maybeSingle();

        if (!docError && doc) {
          // Load associated image if available
          if (doc.storage_path) {
            const { data: img } = await supabase
              .from('vehicle_images')
              .select('id, image_url, medium_url, large_url, created_at')
              .eq('id', id)
              .maybeSingle();

            if (img) {
              setData({
                id: doc.id,
                image_url: img.image_url,
                medium_url: img.medium_url,
                large_url: img.large_url,
                created_at: doc.created_at || img.created_at
              } as ImageData);
              setDetectedType('image');
            } else {
              setData({
                id: doc.id,
                created_at: doc.created_at
              } as any);
              setDetectedType('document');
            }
          } else {
            setData({
              id: doc.id,
              created_at: doc.created_at
            } as any);
            setDetectedType('document');
          }
          setLoading(false);
          return;
        }
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading ID data:', error);
      setLoading(false);
    }
  };

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = rect.right + 12;
      let top = rect.top;

      if (left + 400 > viewportWidth) {
        left = rect.left - 412;
      }
      if (top + 500 > viewportHeight) {
        top = viewportHeight - 520;
      }
      if (top < 0) {
        top = 12;
      }

      setCardPosition({ top, left });
    }

    hoverTimeoutRef.current = setTimeout(() => {
      loadData();
      setShowCard(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setShowCard(false);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // If it's an image, use ImageHoverPreview for better UX
  if (detectedType === 'image' && data && 'image_url' in data) {
    return (
      <ImageHoverPreview
        imageUrl={data.image_url}
        imageId={data.id}
        vehicleId={data.vehicle_id}
        className={className}
      >
        {children}
      </ImageHoverPreview>
    );
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <>
      <span
        ref={containerRef}
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          cursor: 'pointer',
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          fontFamily: 'monospace',
          fontSize: 'inherit'
        }}
      >
        {children}
      </span>

      {showCard && (
        <div
          style={{
            position: 'fixed',
            top: `${cardPosition.top}px`,
            left: `${cardPosition.left}px`,
            zIndex: 10000,
            width: '400px',
            maxHeight: '500px',
            overflowY: 'auto',
            backgroundColor: 'var(--white)',
            border: '2px solid var(--border-medium)',
            borderRadius: '0px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: 'var(--space-3)',
            pointerEvents: 'none'
          }}
          onMouseEnter={() => setShowCard(true)}
          onMouseLeave={handleMouseLeave}
        >
          {loading ? (
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-4)' }}>
              Loading...
            </div>
          ) : data ? (
            <>
              {/* Vehicle Card */}
              {detectedType === 'vehicle' && 'year' in data && (
                <>
                  <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                    Vehicle
                  </div>
                  <div style={{ fontSize: '8pt', marginBottom: 'var(--space-1)' }}>
                    <strong>ID:</strong> {data.id.substring(0, 8)}...
                  </div>
                  {(data.year || data.make || data.model) && (
                    <div style={{ fontSize: '8pt', marginBottom: 'var(--space-1)' }}>
                      <strong>Vehicle:</strong> {data.year} {data.make} {data.model}
                    </div>
                  )}
                  {data.vin && (
                    <div style={{ fontSize: '8pt', marginBottom: 'var(--space-1)', fontFamily: 'monospace' }}>
                      <strong>VIN:</strong> {data.vin}
                    </div>
                  )}
                  {data.created_at && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      <strong>Created:</strong> {formatDate(data.created_at)}
                    </div>
                  )}
                </>
              )}

              {/* User Card */}
              {detectedType === 'user' && 'email' in data && (
                <>
                  <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                    User
                  </div>
                  <div style={{ fontSize: '8pt', marginBottom: 'var(--space-1)' }}>
                    <strong>ID:</strong> {data.id.substring(0, 8)}...
                  </div>
                  {data.email && (
                    <div style={{ fontSize: '8pt', marginBottom: 'var(--space-1)' }}>
                      <strong>Email:</strong> {data.email}
                    </div>
                  )}
                  {data.full_name && (
                    <div style={{ fontSize: '8pt', marginBottom: 'var(--space-1)' }}>
                      <strong>Name:</strong> {data.full_name}
                    </div>
                  )}
                  {data.created_at && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      <strong>Created:</strong> {formatDate(data.created_at)}
                    </div>
                  )}
                </>
              )}

              {/* Document Card */}
              {detectedType === 'document' && (
                <>
                  <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                    Document
                  </div>
                  <div style={{ fontSize: '8pt', marginBottom: 'var(--space-1)' }}>
                    <strong>ID:</strong> {data.id.substring(0, 8)}...
                  </div>
                  {data.created_at && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      <strong>Created:</strong> {formatDate(data.created_at)}
                    </div>
                  )}
                </>
              )}

              {/* Generic ID Card (fallback) */}
              {!detectedType && (
                <>
                  <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                    ID Reference
                  </div>
                  <div style={{ fontSize: '8pt', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {id}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                    No data found for this ID
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              No data found
            </div>
          )}
        </div>
      )}
    </>
  );
};

