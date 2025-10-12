import { supabase } from '../lib/supabase';

export const getLeadImageUrl = async (vehicleId: string, size: 'full' | 'large' | 'medium' = 'large'): Promise<string | null> => {
  if (!vehicleId) return null;

  try {
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('image_url, is_primary, variants')
      .eq('vehicle_id', vehicleId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });

    if (error || !images || images.length === 0) {
      return null;
    }

    const primaryImage = images.find(img => img.is_primary) || images[0];

    if (!primaryImage) return null;

    if (primaryImage.variants && typeof primaryImage.variants === 'object') {
      // If the requested size is available, return it immediately.
      if (size in primaryImage.variants && primaryImage.variants[size]) {
        return primaryImage.variants[size];
      }

      // --- Intelligent Fallback Logic ---
      // If 'large' is requested, fall back to 'full' first.
      if (size === 'large' && primaryImage.variants.full) {
        return primaryImage.variants.full;
      }

      // If 'medium' is requested, try 'large' then 'full'.
      if (size === 'medium') {
        if (primaryImage.variants.large) return primaryImage.variants.large;
        if (primaryImage.variants.full) return primaryImage.variants.full;
      }

      // Generic fallback: Try to find any available variant in order of quality.
      return primaryImage.variants.full || primaryImage.variants.large || primaryImage.variants.medium || primaryImage.image_url;
    }

    return primaryImage.image_url;
  } catch (err) {
    console.error('Error getting lead image URL:', err);
    return null;
  }
};
