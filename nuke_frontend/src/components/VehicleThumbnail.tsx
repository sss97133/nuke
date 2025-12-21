/**
 * SIMPLIFIED VEHICLE THUMBNAIL COMPONENT
 *
 * Stripped down to essentials - no complex fallback chains
 * Direct database lookup, simple error handling
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface VehicleThumbnailProps {
  vehicleId: string;
  vehicleName?: string;
  size?: 'small' | 'medium' | 'large';
  showPlaceholder?: boolean;
  onClick?: () => void;
  className?: string;
  simple?: boolean;
}

const VehicleThumbnail: React.FC<VehicleThumbnailProps> = ({
  vehicleId,
  vehicleName = 'Vehicle',
  size = 'medium',
  showPlaceholder = true,
  onClick,
  className = '',
  simple = false
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      if (!vehicleId || vehicleId.length < 20 || !vehicleId.includes('-')) {
        console.log('Invalid vehicle ID:', vehicleId);
        setLoading(false);
        return;
      }

      try {
        console.log('🔍 Loading images for vehicle:', vehicleId);

        // Step 1: Try to get primary image from vehicle_images table
        const { data: images, error: imagesError } = await supabase
          .from('vehicle_images')
          .select('image_url, is_primary')
          .eq('vehicle_id', vehicleId)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(10);

        if (imagesError) {
          console.error('Images query error:', imagesError);
          throw imagesError;
        }

        console.log('📸 Found images:', images?.length || 0);

        let selectedImageUrl = null;

        if (images && images.length > 0) {
          // Try primary image first
          const primaryImage = images.find(img => img.is_primary);
          selectedImageUrl = primaryImage?.image_url || images[0].image_url;
          console.log('🎯 Selected image:', selectedImageUrl);
        }

        // Step 2: Fallback to vehicle.primary_image_url
        if (!selectedImageUrl) {
          console.log('📋 No images in vehicle_images, checking vehicle record...');
          const { data: vehicle, error: vehicleError } = await supabase
            .from('vehicles')
            .select('primary_image_url')
            .eq('id', vehicleId)
            .single();

          if (vehicleError) {
            console.error('Vehicle query error:', vehicleError);
            throw vehicleError;
          }

          selectedImageUrl = vehicle?.primary_image_url;
          console.log('🚗 Vehicle primary_image_url:', selectedImageUrl);
        }

        // Step 3: Generate proper render URL
        if (selectedImageUrl) {
          const width = size === 'small' ? 220 : size === 'medium' ? 420 : 640;

          // Check if it's a Supabase storage URL that needs transformation
          if (selectedImageUrl.includes('/storage/v1/object/public/')) {
            const transformUrl = selectedImageUrl
              .replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
              + `?width=${width}&quality=70`;

            console.log('🔄 Transform URL:', transformUrl);
            setImageUrl(transformUrl);
          } else {
            console.log('📎 Direct URL:', selectedImageUrl);
            setImageUrl(selectedImageUrl);
          }
        } else {
          console.log('❌ No image found');
          setImageUrl(null);
        }

      } catch (err) {
        console.error('Error loading vehicle image:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setImageUrl(null);
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [vehicleId, size]);

  const sizeStyles = {
    small: { width: '60px', height: '60px' },
    medium: { width: '120px', height: '120px' },
    large: { width: '200px', height: '200px' }
  };

  const containerStyle = {
    ...sizeStyles[size],
    backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '4px',
    overflow: 'hidden',
    cursor: onClick ? 'pointer' : 'default',
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  if (loading) {
    return (
      <div className={className} style={containerStyle}>
        <div style={{ fontSize: size === 'small' ? '12px' : '14px', color: '#666' }}>
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className} style={containerStyle}>
        <div style={{ fontSize: size === 'small' ? '10px' : '12px', color: '#ff6b6b', textAlign: 'center' }}>
          Error: {error}
        </div>
      </div>
    );
  }

  if (imageUrl) {
    return (
      <div className={className} style={containerStyle} onClick={onClick}>
        <img
          src={imageUrl}
          alt={vehicleName}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
          onError={(e) => {
            console.error('Image failed to load:', imageUrl);
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';

            // Show error message in container
            const container = target.parentElement;
            if (container) {
              container.innerHTML = `
                <div style="font-size: ${size === 'small' ? '10px' : '12px'}; color: #ff6b6b; text-align: center; padding: 4px;">
                  Image failed
                </div>
              `;
            }
          }}
          onLoad={() => {
            console.log('✅ Image loaded successfully:', imageUrl);
          }}
        />
      </div>
    );
  }

  // Show placeholder
  if (showPlaceholder) {
    return (
      <div className={className} style={containerStyle} onClick={onClick}>
        <img
          src="/n-zero.png"
          alt="No image"
          style={{
            width: size === 'small' ? '32px' : '48px',
            height: size === 'small' ? '32px' : '48px',
            opacity: 0.3,
            objectFit: 'contain'
          }}
        />
      </div>
    );
  }

  return null;
};

export default VehicleThumbnail;