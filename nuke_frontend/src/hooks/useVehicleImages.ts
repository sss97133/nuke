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
        .select('*, variants')
        .eq('vehicle_id', vehicleId);

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

  const loadVehiclesWithImages = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch vehicles and images separately to avoid PostgREST ambiguity
      const { data: allVehiclesData, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('*');

      if (vehiclesError) {
        throw vehiclesError;
      }

      if (!allVehiclesData || allVehiclesData.length === 0) {
        setVehicles([]);
        return;
      }

      // Fetch primary images for all vehicles
      const vehicleIds = allVehiclesData.map(v => v.id);
      const { data: primaryImages, error: imagesError } = await supabase
        .from('vehicle_images')
        .select('vehicle_id, image_url, is_primary')
        .in('vehicle_id', vehicleIds)
        .eq('is_primary', true);

      if (imagesError) {
        throw imagesError;
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
