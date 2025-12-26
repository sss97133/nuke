import { supabase } from '../lib/supabase';
import exifr from 'exifr';

export interface ImageVariants {
  full: string;
  thumbnail: Blob | null;
  medium: Blob | null;
  large: Blob | null;
}

export interface ImageVariantBlobs {
  thumbnail: Blob | null;
  medium: Blob | null;
  large: Blob | null;
}

export interface OptimizationResult {
  success: boolean;
  variants?: ImageVariants;
  variantBlobs?: ImageVariantBlobs;
  error?: string;
}

class ImageOptimizationService {
  private readonly SIZES = {
    thumbnail: { width: 150, quality: 0.8 },
    medium: { width: 400, quality: 0.85 },
    large: { width: 1200, quality: 0.9 },
  };

  /**
   * Generate optimized variants as blobs (for upload integration)
   * Uses browser Canvas API for client-side optimization
   */
  async generateVariantBlobs(file: File): Promise<OptimizationResult> {
    try {
      // Check if file is HEIC format - not supported for optimization
      if (file.name.toLowerCase().includes('.heic') || file.type.includes('heic')) {
        console.log('HEIC format detected, skipping optimization');
        return {
          success: true,
          variantBlobs: {
            thumbnail: null,
            medium: null,
            large: null
          }
        };
      }

      const variantBlobs: Partial<ImageVariantBlobs> = {};

      // Create image element
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = objectUrl;
      });

      // Read EXIF orientation once
      let orientation: number | undefined;
      try {
        const exif = await exifr.parse(file, { tiff: true });
        orientation = (exif as any)?.Orientation;
      } catch {}

      // Generate each size variant
      for (const [sizeName, config] of Object.entries(this.SIZES)) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        // Calculate dimensions maintaining aspect ratio
        const aspectRatio = img.height / img.width;
        let newWidth = config.width;
        let newHeight = config.width * aspectRatio;
        // Don't upscale
        if (img.width < config.width) {
          newWidth = img.width;
          newHeight = img.height;
        }

        // If the image needs rotation (orientation 5-8), swap target dimensions
        const needsSwap = orientation && [5, 6, 7, 8].includes(orientation);
        canvas.width = Math.round(needsSwap ? newHeight : newWidth);
        canvas.height = Math.round(needsSwap ? newWidth : newHeight);

        // Apply orientation transform then draw
        this.applyOrientationTransform(ctx, orientation, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Convert to blob
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Failed to create blob'));
            },
            'image/jpeg',
            config.quality
          );
        });

        variantBlobs[sizeName as keyof ImageVariantBlobs] = blob;
      }

      // Clean up
      URL.revokeObjectURL(objectUrl);

      return {
        success: true,
        variantBlobs: variantBlobs as ImageVariantBlobs
      };
    } catch (error) {
      console.warn('Image optimization failed, skipping optimization:', error);
      // Return success but with no variants to allow upload to continue
      return {
        success: false,
        error,
        variantBlobs: {
          thumbnail: null,
          medium: null,
          large: null
        }
      };
    }
  }

  /**
   * Generate optimized variants of an image
   * Uses browser Canvas API for client-side optimization
   */
  async generateVariants(file: File): Promise<OptimizationResult> {
    try {
      // Check if file is HEIC format - not supported for optimization
      if (file.name.toLowerCase().includes('.heic') || file.type.includes('heic')) {
        console.log('HEIC format detected, skipping optimization');
        return {
          success: false,
          error: 'HEIC format not supported for optimization',
          variants: {
            full: '',
            thumbnail: null,
            medium: null,
            large: null
          }
        };
      }

      const variants: Partial<ImageVariants> = {};

      // Create image element
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = objectUrl;
      });

      // Read EXIF orientation once
      let orientation: number | undefined;
      try {
        const exif = await exifr.parse(file, { tiff: true });
        orientation = (exif as any)?.Orientation;
      } catch {}

      // Generate each size variant
      for (const [sizeName, config] of Object.entries(this.SIZES)) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        // Calculate dimensions maintaining aspect ratio
        const aspectRatio = img.height / img.width;
        let newWidth = config.width;
        let newHeight = config.width * aspectRatio;
        // Don't upscale
        if (img.width < config.width) {
          newWidth = img.width;
          newHeight = img.height;
        }

        // If the image needs rotation (orientation 5-8), swap target dimensions
        const needsSwap = orientation && [5, 6, 7, 8].includes(orientation);
        canvas.width = Math.round(needsSwap ? newHeight : newWidth);
        canvas.height = Math.round(needsSwap ? newWidth : newHeight);

        // Apply orientation transform then draw
        this.applyOrientationTransform(ctx, orientation, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Convert to blob
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Failed to create blob'));
            },
            'image/jpeg',
            config.quality
          );
        });

        // Convert blob to data URL for storage
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        variants[sizeName as keyof ImageVariants] = dataUrl;
      }

      // Clean up
      URL.revokeObjectURL(objectUrl);

      // Original file as data URL
      const originalReader = new FileReader();
      const originalDataUrl = await new Promise<string>((resolve, reject) => {
        originalReader.onload = () => resolve(originalReader.result as string);
        originalReader.onerror = reject;
        originalReader.readAsDataURL(file);
      });

      return {
        success: true,
        variants: {
          ...variants,
          full: originalDataUrl
        } as ImageVariants
      };
    } catch (error) {
      console.error('Image optimization failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Upload optimized variants to Supabase storage
   */
  async uploadVariants(
    vehicleId: string,
    fileName: string,
    variants: ImageVariants
  ): Promise<{ urls: ImageVariants; paths: Record<string, string> }> {
    const urls: Partial<ImageVariants> = {};
    const paths: Record<string, string> = {};

    for (const [variantName, dataUrl] of Object.entries(variants)) {
      // Convert data URL to blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // Generate path for variant
      const variantPath = `vehicles/${vehicleId}/images/${variantName}/${fileName}`;
      
      // Upload to storage
      const { data, error } = await supabase.storage
        .from('vehicle-data')
        .upload(variantPath, blob, { upsert: true });

      if (!error && data) {
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(variantPath);

        urls[variantName as keyof ImageVariants] = urlData.publicUrl;
        paths[variantName] = variantPath;
      }
    }

    return { 
      urls: urls as ImageVariants, 
      paths 
    };
  }

  /**
   * Process existing images to generate missing variants
   */
  async processExistingImage(imageUrl: string, vehicleId: string): Promise<OptimizationResult> {
    try {
      // Fetch the image
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], 'image.jpg', { type: blob.type });

      // Generate variants
      const result = await this.generateVariants(file);
      
      if (result.success && result.variants) {
        // Extract filename from URL
        const urlParts = imageUrl.split('/');
        const fileName = urlParts[urlParts.length - 1];

        // Upload variants
        const { urls } = await this.uploadVariants(vehicleId, fileName, result.variants);

        return {
          success: true,
          variants: urls
        };
      }

      return result;
    } catch (error) {
      console.error('Failed to process existing image:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Apply canvas transform according to EXIF orientation (1..8)
   * See: https://magnushoff.com/articles/jpeg-orientation/
   */
  private applyOrientationTransform(
    ctx: CanvasRenderingContext2D,
    orientation: number | undefined,
    width: number,
    height: number
  ) {
    switch (orientation) {
      case 2: // Mirror horizontally
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        break;
      case 3: // Rotate 180
        ctx.translate(width, height);
        ctx.rotate(Math.PI);
        break;
      case 4: // Mirror vertically
        ctx.translate(0, height);
        ctx.scale(1, -1);
        break;
      case 5: // Mirror horizontally and rotate 90 CW
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(0, -height);
        ctx.scale(1, -1);
        break;
      case 6: // Rotate 90 CW
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(0, -height);
        break;
      case 7: // Mirror horizontally and rotate 90 CCW
        ctx.rotate(-0.5 * Math.PI);
        ctx.translate(-width, 0);
        ctx.scale(1, -1);
        break;
      case 8: // Rotate 90 CCW
        ctx.rotate(-0.5 * Math.PI);
        ctx.translate(-width, 0);
        break;
      default:
        // 1 or undefined: no transform
        break;
    }
  }

  /**
   * Get the appropriate image URL based on context
   */
  getOptimizedUrl(
    imageData: { 
      thumbnail_url?: string; 
      medium_url?: string; 
      large_url?: string; 
      image_url: string 
    },
    size: 'thumbnail' | 'medium' | 'large' | 'full'
  ): string {
    switch (size) {
      case 'thumbnail':
        return imageData.thumbnail_url || imageData.image_url;
      case 'medium':
        return imageData.medium_url || imageData.image_url;
      case 'large':
        return imageData.large_url || imageData.image_url;
      case 'full':
      default:
        return imageData.image_url;
    }
  }
}

export const imageOptimizationService = new ImageOptimizationService();
