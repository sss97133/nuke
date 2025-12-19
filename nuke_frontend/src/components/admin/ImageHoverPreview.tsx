/**
 * ImageHoverPreview - Shows medium-res image preview and extraction date on hover
 * Usage: Wrap any image URL reference with this component
 */

import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ImageHoverPreviewProps {
  imageUrl: string;
  imageId?: string;
  vehicleId?: string;
  children: React.ReactNode;
  className?: string;
}

interface ImageData {
  id: string;
  image_url: string;
  medium_url?: string;
  large_url?: string;
  created_at: string;
  extracted_at?: string;
  ai_scan_metadata?: any;
}

export const ImageHoverPreview: React.FC<ImageHoverPreviewProps> = ({
  imageUrl,
  imageId,
  vehicleId,
  children,
  className = ''
}) => {
  const [showPreview, setShowPreview] = useState(false);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ top: 0, left: 0 });
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadImageData = async () => {
    if (imageData) return; // Already loaded
    
    setLoading(true);
    try {
      let data: ImageData | null = null;

      // If we have imageId, fetch from database
      if (imageId) {
        const { data: img, error } = await supabase
          .from('vehicle_images')
          .select('id, image_url, medium_url, large_url, created_at, ai_scan_metadata')
          .eq('id', imageId)
          .single();

        if (!error && img) {
          // Extract extraction date from metadata
          let extractedAt: string | undefined;
          if (img.ai_scan_metadata) {
            const meta = img.ai_scan_metadata;
            if (meta.extractions) {
              // Get latest extraction date
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

          data = {
            id: img.id,
            image_url: img.image_url,
            medium_url: img.medium_url,
            large_url: img.large_url,
            created_at: img.created_at,
            extracted_at: extractedAt,
            ai_scan_metadata: img.ai_scan_metadata
          };
        }
      } else if (vehicleId && imageUrl) {
        // Try to find by URL and vehicle
        const { data: img } = await supabase
          .from('vehicle_images')
          .select('id, image_url, medium_url, large_url, created_at, ai_scan_metadata')
          .eq('vehicle_id', vehicleId)
          .eq('image_url', imageUrl)
          .limit(1)
          .maybeSingle();

        if (img) {
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

          data = {
            id: img.id,
            image_url: img.image_url,
            medium_url: img.medium_url,
            large_url: img.large_url,
            created_at: img.created_at,
            extracted_at: extractedAt,
            ai_scan_metadata: img.ai_scan_metadata
          };
        }
      }

      // Fallback: create minimal data from URL
      if (!data) {
        data = {
          id: imageId || '',
          image_url: imageUrl,
          created_at: new Date().toISOString()
        };
      }

      setImageData(data);
    } catch (error) {
      console.error('Error loading image data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMouseEnter = (e: React.MouseEvent) => {
    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // Calculate position for preview
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Position to the right, or left if not enough space
      let left = rect.right + 12;
      let top = rect.top;

      // Adjust if would go off screen
      if (left + 320 > viewportWidth) {
        left = rect.left - 332; // 320px width + 12px gap
      }
      if (top + 400 > viewportHeight) {
        top = viewportHeight - 420;
      }
      if (top < 0) {
        top = 12;
      }

      setPreviewPosition({ top, left });
    }

    // Load data and show preview after short delay
    hoverTimeoutRef.current = setTimeout(() => {
      loadImageData();
      setShowPreview(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setShowPreview(false);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const previewImageUrl = imageData?.medium_url || imageData?.large_url || imageData?.image_url || imageUrl;
  const extractionDate = imageData?.extracted_at 
    ? new Date(imageData.extracted_at).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : null;
  const createdDate = imageData?.created_at
    ? new Date(imageData.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    : null;

  return (
    <>
      <span
        ref={containerRef}
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
      >
        {children}
      </span>

      {showPreview && (
        <div
          style={{
            position: 'fixed',
            top: `${previewPosition.top}px`,
            left: `${previewPosition.left}px`,
            zIndex: 10000,
            width: '320px',
            backgroundColor: 'var(--white)',
            border: '2px solid var(--border-medium)',
            borderRadius: '0px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: 'var(--space-3)',
            pointerEvents: 'none'
          }}
          onMouseEnter={() => setShowPreview(true)}
          onMouseLeave={handleMouseLeave}
        >
          {loading ? (
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-4)' }}>
              Loading...
            </div>
          ) : (
            <>
              <img
                src={previewImageUrl}
                alt="Preview"
                style={{
                  width: '100%',
                  height: '240px',
                  objectFit: 'contain',
                  backgroundColor: 'var(--bg)',
                  marginBottom: 'var(--space-2)'
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div style={{ fontSize: '8pt', color: 'var(--text)' }}>
                <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>Image Preview</div>
                {extractionDate && (
                  <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
                    Extracted: {extractionDate}
                  </div>
                )}
                {createdDate && (
                  <div style={{ color: 'var(--text-muted)' }}>
                    Created: {createdDate}
                  </div>
                )}
                {!extractionDate && (
                  <div style={{ color: 'var(--warning)', fontSize: '8pt' }}>
                    No extraction data
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

