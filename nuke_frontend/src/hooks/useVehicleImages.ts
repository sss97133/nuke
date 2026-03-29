// Vehicle Image Pipeline Hook
// Centralized image loading and management for all components

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface VehicleImage {
  id: string;
  vehicle_id: string;
  image_url: string;
  file_name?: string;
  is_primary: boolean;
  category?: string;
  caption?: string;
  taken_at?: string;
  variants?: {
    thumbnail?: string;
    medium?: string;
    large?: string;
    full?: string;
  };
  created_at: string;
}

const hasWindow = typeof window !== 'undefined';
const hostKey = hasWindow ? String(window.location?.host || '') : 'server';
const tableMissingKey = `table_missing_vehicle_images__${hostKey}`;

function isTableMarkedMissing(): boolean {
  if (!hasWindow) return false;
  try {
    return window.localStorage.getItem(tableMissingKey) === '1';
  } catch {
    return false;
  }
}

function markTableMissing(): void {
  if (!hasWindow) return;
  try {
    window.localStorage.setItem(tableMissingKey, '1');
  } catch {
    // ignore
  }
}

function isValidVehicleId(vehicleId: string | undefined): boolean {
  return !!vehicleId && vehicleId.length >= 20 && vehicleId.includes('-');
}

async function fetchVehicleImages(vehicleId: string): Promise<VehicleImage[]> {
  if (isTableMarkedMissing()) return [];

  const { data, error: fetchError } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, file_name, caption, is_primary, category, variants, created_at, taken_at')
    .eq('vehicle_id', vehicleId)
    // Legacy rows may have is_document = NULL; treat that as "not a document"
    .not('is_document', 'is', true)
    // Quarantine/duplicate rows should never appear in standard galleries
    .or('is_duplicate.is.null,is_duplicate.eq.false')
    // Hide AI-detected mismatched/unrelated images
    .or('image_vehicle_match_status.is.null,image_vehicle_match_status.not.in.("mismatch","unrelated")')
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false });
    // NO LIMIT - show ALL images from all sources

  if (fetchError) {
    const status = (fetchError as any)?.status ?? (fetchError as any)?.statusCode;
    const code = String((fetchError as any)?.code || '').toUpperCase();
    const msg = String((fetchError as any)?.message || '').toLowerCase();
    const isMissingColumn =
      code === '42703' ||
      (msg.includes('column') && msg.includes('does not exist'));

    const missing =
      code === '42P01' ||
      (status === 404 && !isMissingColumn);
    if (missing) {
      markTableMissing();
      return [];
    }
    console.error('Supabase error:', fetchError);
    throw fetchError;
  }

  return data || [];
}

export const useVehicleImages = (vehicleId?: string) => {
  const enabled = isValidVehicleId(vehicleId);

  const { data: images = [], isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['vehicle-images', vehicleId],
    queryFn: () => fetchVehicleImages(vehicleId!),
    enabled,
  });

  const primaryImage = useMemo(() => {
    if (images.length === 0) return null;
    let primary = images.find(img => img.is_primary === true);
    if (!primary) {
      primary = images.find(img => !img.category?.includes('document')) || images[0];
    }
    return primary || null;
  }, [images]);

  const imageUrls = useMemo(() => images.map(img => img.image_url), [images]);

  return {
    images,
    primaryImage,
    loading: isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load images') : null,
    refreshImages: refetch,
    imageUrls,
    hasImages: images.length > 0,
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
