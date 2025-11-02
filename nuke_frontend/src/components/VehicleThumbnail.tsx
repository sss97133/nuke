/**
 * CONSOLIDATED VEHICLE THUMBNAIL COMPONENT
 *
 * This component replaces the redundant VehicleThumbnailSimple.tsx.
 *
 * Features:
 * - Hook-based image loading (default) for cached performance
 * - Direct query mode (simple: true) for immediate display
 * - Consistent styling and behavior across both modes
 * - Fallback to primary_image_url field
 * - Configurable placeholder display
 */

import React, { useState, useEffect } from 'react';
import { useVehicleImages } from '../hooks/useVehicleImages';
import { supabase } from '../lib/supabase';

interface VehicleThumbnailProps {
  vehicleId: string;
  vehicleName?: string;
  size?: 'small' | 'medium' | 'large';
  showPlaceholder?: boolean;
  onClick?: () => void;
  className?: string;
  simple?: boolean; // New prop: use direct query instead of hooks
}

// Helper function to get optimal image variant based on size
const getOptimalImageUrl = (imageData: any, size: 'small' | 'medium' | 'large'): string | null => {
  if (!imageData) return null;

  // If variants are available, use them
  if (imageData.variants && typeof imageData.variants === 'object') {
    switch (size) {
      case 'small':
        return imageData.variants.thumbnail || imageData.variants.medium || imageData.variants.large || imageData.variants.full || imageData.image_url;
      case 'medium':
        return imageData.variants.large || imageData.variants.medium || imageData.variants.full || imageData.variants.thumbnail || imageData.image_url;
      case 'large':
        return imageData.variants.large || imageData.variants.full || imageData.variants.medium || imageData.variants.thumbnail || imageData.image_url;
      default:
        return imageData.image_url;
    }
  }

  // Fallback to original image_url
  return imageData.image_url || null;
};

const VehicleThumbnail: React.FC<VehicleThumbnailProps> = ({
  vehicleId,
  vehicleName = 'Vehicle',
  size = 'medium',
  showPlaceholder = true,
  onClick,
  className = '',
  simple = false
}) => {
  // Hook-based loading (default mode)
  const { primaryImage, loading: hookLoading, images, error } = useVehicleImages(vehicleId);

  // Simple mode state (direct query)
  const [simpleImageUrl, setSimpleImageUrl] = useState<string | null>(null);
  const [simpleLoading, setSimpleLoading] = useState(simple);

  // Fallback vehicle data for both modes
  const [vehicleData, setVehicleData] = useState<any>(null);
  
  // Fetch vehicle data and handle simple mode loading
  useEffect(() => {
    const loadData = async () => {
      if (!vehicleId || vehicleId.length < 20 || !vehicleId.includes('-')) return;

      // Always fetch vehicle fallback data
      const { data: vehicleData } = await supabase
        .from('vehicles')
        .select('primary_image_url')
        .eq('id', vehicleId)
        .single();

      if (vehicleData) {
        setVehicleData(vehicleData);
      }

      // Handle simple mode image loading (direct query)
      if (simple) {
        try {
          const { data, error } = await supabase
            .from('vehicle_images')
            .select('image_url, is_primary, variants')
            .eq('vehicle_id', vehicleId)
            .order('uploaded_at', { ascending: false })
            .limit(5);

          if (error) {
            console.error('Simple mode database error:', error);
            setSimpleImageUrl(null);
          } else if (data && data.length > 0) {
            // Find primary image or use first one
            const primaryImageData = data.find(img => img.is_primary) || data[0];
            const optimalUrl = getOptimalImageUrl(primaryImageData, size);
            setSimpleImageUrl(optimalUrl);
          } else {
            setSimpleImageUrl(null);
          }
        } catch (err) {
          console.error('Simple mode error loading image:', err);
          setSimpleImageUrl(null);
        } finally {
          setSimpleLoading(false);
        }
      }
    };

    loadData();
  }, [vehicleId, simple]);
  

  const sizeStyles = {
    small: { width: '60px', height: '60px' },
    medium: { width: '120px', height: '120px' },
    large: { width: '200px', height: '200px' }
  };

  const containerStyle = simple ? {
    ...sizeStyles[size],
    backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '4px',
    overflow: 'hidden',
    cursor: onClick ? 'pointer' : 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  } : {
    backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '4px',
    overflow: 'hidden',
    cursor: onClick ? 'pointer' : 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '120px'
  };

  // Determine loading state and image URL based on mode
  const loading = simple ? simpleLoading : hookLoading;
  const imageUrl = simple
    ? simpleImageUrl || vehicleData?.primary_image_url
    : getOptimalImageUrl(primaryImage, size) || vehicleData?.primary_image_url;

  if (loading) {
    return (
      <div className={className} style={containerStyle}>
        <div style={{ fontSize: size === 'small' ? '12px' : '14px', color: '#666' }}>
          Loading...
        </div>
      </div>
    );
  }
  
  if (imageUrl) {
    console.log('Rendering image:', imageUrl);
    return (
      <div className={className} style={containerStyle} onClick={onClick}>
        <img
          src={imageUrl}
          alt={vehicleName}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
          onError={(e) => {
            console.error('Image failed to load:', imageUrl);
            console.error('Error event:', e);
          }}
          onLoad={() => {
            console.log('Image loaded successfully:', imageUrl);
          }}
        />
      </div>
    );
  }

  if (showPlaceholder || simple) {
    return (
      <div className={className} style={containerStyle} onClick={onClick}>
        <img 
          src="/n-zero.png" 
          alt="N-Zero"
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
