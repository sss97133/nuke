/**
 * Centralized Image Quality Configuration
 * Ensures consistent image quality across all components
 */

export const IMAGE_QUALITY = {
  // Supabase render API quality (0-100 scale)
  thumbnail: 80,   // Small thumbnails - good balance of size/quality
  small: 80,       // Small images
  medium: 85,      // Medium images - high quality
  large: 90,       // Large images - very high quality
  hero: 90,        // Hero images - maximum quality
  full: 95,        // Full resolution - near lossless
  
  // Canvas API quality (0-1 scale for toBlob)
  canvas: {
    thumbnail: 0.8,
    medium: 0.85,
    large: 0.9,
    full: 0.95
  }
} as const;

/**
 * Get quality setting for a given size
 */
export function getImageQuality(size: 'thumbnail' | 'small' | 'medium' | 'large' | 'hero' | 'full'): number {
  return IMAGE_QUALITY[size] || IMAGE_QUALITY.medium;
}

/**
 * Get canvas quality (0-1 scale) for a given size
 */
export function getCanvasQuality(size: 'thumbnail' | 'medium' | 'large' | 'full'): number {
  return IMAGE_QUALITY.canvas[size] || IMAGE_QUALITY.canvas.medium;
}

