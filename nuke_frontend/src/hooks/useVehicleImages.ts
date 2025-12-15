// Vehicle Image Pipeline Hook
// Centralized image loading and management for all components

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface VehicleImage {
  id: string;
  vehicle_id: string;
  image_url: string;
  file_name?: string;
  file_path?: string;
  is_primary: boolean;
  is_public: boolean;
  category?: string;
  description?: string;
  variants?: {
    thumbnail?: string;
    medium?: string;
    large?: string;
    full?: string;
  };
  created_at: string;
}

export const useVehicleImages = (vehicleId?: string) => {
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [primaryImage, setPrimaryImage] = useState<VehicleImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadImages = async () => {
    if (!vehicleId) return;
    
    // Skip database query for local storage vehicles (timestamp IDs)
    if (vehicleId.length < 20 || !vehicleId.includes('-')) {
      console.log('Skipping database query for local vehicle:', vehicleId);
      setImages([]);
      setPrimaryImage(null);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: fetchError } = await supabase
        .from('vehicle_images')
        // Keep payload lean to reduce the chance of statement timeouts / 500s on large image tables
        .select('id, vehicle_id, image_url, file_name, file_path, is_primary, is_public, category, description, variants, created_at')
        .eq('vehicle_id', vehicleId)
        .eq('is_document', false)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(250);

      if (fetchError) {
        console.error('Supabase error:', fetchError);
        throw fetchError;
      }

      const vehicleImages = data || [];
      setImages(vehicleImages);
      
      // Find primary image or use first image
      const primary = vehicleImages.find(img => img.is_primary) || vehicleImages[0] || null;
      setPrimaryImage(primary);
      
    } catch (err) {
      console.error('Error loading vehicle images:', err);
      setError(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImages();
  }, [vehicleId]);

  const refreshImages = () => {
    loadImages();
  };

  return {
    images,
    primaryImage,
    loading,
    error,
    refreshImages,
    imageUrls: images.map(img => img.image_url),
    hasImages: images.length > 0
  };
};

// Hook for loading multiple vehicles with their primary images
export const useVehiclesWithImages = () => {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const loadVehiclesWithImages = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id || null;
      if (!userId) {
        setVehicles([]);
        return;
      }

      // Fetch vehicles scoped to current user to avoid huge table scans/timeouts in production.
      // Include both `user_id` and `uploaded_by` as legacy/new ownership fields.
      const { data: allVehiclesData, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('*')
        .or(`user_id.eq.${userId},uploaded_by.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(250);

      if (vehiclesError) {
        throw vehiclesError;
      }

      if (!allVehiclesData || allVehiclesData.length === 0) {
        setVehicles([]);
        return;
      }

      // Fetch primary images for all vehicles
      const vehicleIds = allVehiclesData.map(v => v.id);
      const primaryImages: any[] = [];
      for (const ids of chunk(vehicleIds, 150)) {
        const { data: batch, error: imagesError } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url, is_primary')
          .in('vehicle_id', ids)
          .eq('is_primary', true);

        if (imagesError) {
          throw imagesError;
        }
        (batch || []).forEach((row: any) => primaryImages.push(row));
      }

      // Create map of vehicle_id -> primary image URL
      const primaryImageMap = new Map<string, string>();
      (primaryImages || []).forEach(img => {
        if (img.is_primary && img.image_url) {
          primaryImageMap.set(img.vehicle_id, img.image_url);
        }
      });

      // Combine and format results
      const allVehicles = allVehiclesData.map(vehicle => ({
        ...vehicle,
        primaryImage: primaryImageMap.get(vehicle.id) || null
      }));

      setVehicles(allVehicles);
      
    } catch (err) {
      console.error('Error loading vehicles with images:', err);
      setError(err instanceof Error ? err.message : 'Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVehiclesWithImages();
  }, []);

  return {
    vehicles,
    loading,
    error,
    refreshVehicles: loadVehiclesWithImages
  };
};
