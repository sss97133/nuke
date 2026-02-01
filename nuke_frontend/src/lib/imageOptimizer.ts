/**
 * Image URL Optimizer
 *
 * Automatically resizes images from supported sources to reduce bandwidth:
 * - Bring a Trailer (BaT): Uses WordPress Photon CDN (?w=X parameter)
 * - Supabase Storage: Uses render API with width/quality
 * - Other sources: Returns original URL
 */

export type ImageSize = 'thumbnail' | 'small' | 'medium' | 'large' | 'full';

const SIZE_CONFIG: Record<ImageSize, { width: number; quality: number }> = {
  thumbnail: { width: 150, quality: 75 },
  small: { width: 300, quality: 80 },
  medium: { width: 600, quality: 85 },
  large: { width: 1200, quality: 90 },
  full: { width: 0, quality: 100 }, // No resize
};

/**
 * Optimize an image URL for the given display size
 *
 * @param url - Original image URL
 * @param size - Target display size
 * @returns Optimized URL with resize parameters
 */
export function optimizeImageUrl(url: string | null | undefined, size: ImageSize = 'medium'): string | null {
  if (!url) return null;

  // Don't resize if full size requested
  if (size === 'full') return url;

  const { width, quality } = SIZE_CONFIG[size];

  try {
    // Bring a Trailer - uses WordPress Photon CDN
    if (url.includes('bringatrailer.com')) {
      // Remove any existing query params and add resize
      const baseUrl = url.split('?')[0];
      return `${baseUrl}?w=${width}`;
    }

    // Supabase Storage - use render API
    if (url.includes('/storage/v1/object/public/')) {
      return url
        .replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
        + `?width=${width}&quality=${quality}`;
    }

    // Already using Supabase render API - update params
    if (url.includes('/storage/v1/render/image/')) {
      const baseUrl = url.split('?')[0];
      return `${baseUrl}?width=${width}&quality=${quality}`;
    }

    // Cars & Bids - also WordPress, same pattern
    if (url.includes('carsandbids.com')) {
      const baseUrl = url.split('?')[0];
      return `${baseUrl}?w=${width}`;
    }

    // Craigslist - images are typically already small
    // Return as-is
    if (url.includes('craigslist.org')) {
      return url;
    }

    // Unknown source - return original
    return url;
  } catch (e) {
    console.warn('[imageOptimizer] Error processing URL:', e);
    return url;
  }
}

/**
 * Get optimized URL for grid/card display (small)
 */
export function getGridImageUrl(url: string | null | undefined): string | null {
  return optimizeImageUrl(url, 'small');
}

/**
 * Get optimized URL for thumbnail display
 */
export function getThumbnailUrl(url: string | null | undefined): string | null {
  return optimizeImageUrl(url, 'thumbnail');
}

/**
 * Get optimized URL for detail/lightbox display (large but not full)
 */
export function getDetailImageUrl(url: string | null | undefined): string | null {
  return optimizeImageUrl(url, 'large');
}

/**
 * Check if a URL is from a supported CDN that can be optimized
 */
export function isOptimizableUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    url.includes('bringatrailer.com') ||
    url.includes('carsandbids.com') ||
    url.includes('/storage/v1/')
  );
}
