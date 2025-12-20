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
import ResilientImage from './images/ResilientImage';

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

const buildCandidateUrls = (imageData: any, size: 'small' | 'medium' | 'large'): string[] => {
  if (!imageData) return [];

  const out: string[] = [];
  const add = (v: any) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) return;
    if (!out.includes(s)) out.push(s);
  };

  const variants = imageData?.variants && typeof imageData.variants === 'object' ? imageData.variants : null;
  if (variants) {
    if (size === 'small') {
      add(variants.thumbnail);
      add(variants.medium);
      add(variants.large);
      add(variants.full);
    } else if (size === 'medium') {
      add(variants.medium);
      add(variants.large);
      add(variants.full);
      add(variants.thumbnail);
    } else {
      add(variants.large);
      add(variants.full);
      add(variants.medium);
      add(variants.thumbnail);
    }
  }

  add(imageData.thumbnail_url);
  add(imageData.medium_url);
  add(imageData.large_url);
  add(imageData.image_url);

  // Preserve existing helper's best guess as a last prioritization hint.
  add(getOptimalImageUrl(imageData, size));
  return out;
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
        .select('primary_image_url, image_url')
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
            .select('image_url, is_primary, variants, created_at, taken_at')
            .eq('vehicle_id', vehicleId)
            .order('created_at', { ascending: false })
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
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  } : {
    backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '4px',
    overflow: 'hidden',
    cursor: onClick ? 'pointer' : 'default',
    position: 'relative' as const,
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

  const candidateUrls = React.useMemo(() => {
    const urls: string[] = [];
    const add = (v: any) => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) return;
      if (!urls.includes(s)) urls.push(s);
    };

    // 1) Primary image (from hook)
    buildCandidateUrls(primaryImage, size).forEach(add);
    // 2) A few other recent images (from hook)
    (images || []).slice(0, 8).forEach((img: any) => {
      buildCandidateUrls(img, size).forEach(add);
    });
    // 3) Simple-mode resolved URL
    add(simpleImageUrl);
    // 4) Vehicle record fallbacks
    add(vehicleData?.primary_image_url);
    add(vehicleData?.image_url);

    return urls;
  }, [primaryImage, images, simpleImageUrl, vehicleData?.primary_image_url, vehicleData?.image_url, size]);

  if (loading) {
    return (
      <div className={className} style={containerStyle}>
        <div style={{ fontSize: size === 'small' ? '12px' : '14px', color: '#666' }}>
          Loading...
        </div>
      </div>
    );
  }
  
  if (imageUrl || candidateUrls.length > 0) {
    console.log('Rendering image:', imageUrl);
    return (
      <div className={className} style={containerStyle} onClick={onClick}>
        <ResilientImage
          sources={candidateUrls}
          alt={vehicleName}
          fill={true}
          objectFit="cover"
          placeholderSrc="/n-zero.png"
          placeholderOpacity={0.3}
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
