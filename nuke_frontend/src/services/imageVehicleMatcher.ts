/**
 * Image-to-Vehicle Auto-Matching Service
 * 
 * Automatically matches unorganized images to vehicles based on:
 * - GPS coordinate proximity (images taken at same/similar locations)
 * - Filename patterns (matching naming conventions)
 * - Date proximity (images taken around same time)
 * - User ownership (only matches to user's own vehicles)
 */

import { supabase } from '../lib/supabase';

export interface ImageMatchResult {
  imageId: string;
  vehicleId: string | null;
  confidence: number; // 0-1
  matchReasons: string[];
  vehicleInfo?: {
    year: number | null;
    make: string | null;
    model: string | null;
  };
}

export interface MatchOptions {
  maxGpsDistanceMeters?: number; // Default: 50m
  maxDateDifferenceDays?: number; // Default: 30 days
  minConfidence?: number; // Default: 0.5 (50%)
  userId?: string; // If provided, only matches to user's vehicles
}

export class ImageVehicleMatcher {
  private static readonly DEFAULT_OPTIONS: Required<MatchOptions> = {
    maxGpsDistanceMeters: 50,
    maxDateDifferenceDays: 30,
    minConfidence: 0.5,
    userId: ''
  };

  /**
   * Match a single unorganized image to vehicles
   */
  static async matchImage(
    imageId: string,
    options: MatchOptions = {}
  ): Promise<ImageMatchResult | null> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    // Get the unorganized image
    const { data: image, error: imageError } = await supabase
      .from('vehicle_images')
      .select('id, filename, latitude, longitude, taken_at, user_id, exif_data')
      .eq('id', imageId)
      .is('vehicle_id', null)
      .single();

    if (imageError || !image) {
      console.error('Image not found or already organized:', imageError);
      return null;
    }

    // Get user's vehicles
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, user_id')
      .eq('user_id', image.user_id);

    if (vehiclesError || !vehicles || vehicles.length === 0) {
      console.log('No vehicles found for user');
      return null;
    }

    // Score each vehicle
    const scores: Array<{
      vehicleId: string;
      score: number;
      reasons: string[];
      vehicle: any;
    }> = [];

    for (const vehicle of vehicles) {
      const match = await this.scoreVehicleMatch(image, vehicle, opts);
      if (match.score >= opts.minConfidence) {
        scores.push({
          vehicleId: vehicle.id,
          score: match.score,
          reasons: match.reasons,
          vehicle
        });
      }
    }

    if (scores.length === 0) {
      return null;
    }

    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);
    const bestMatch = scores[0];

    return {
      imageId: image.id,
      vehicleId: bestMatch.vehicleId,
      confidence: bestMatch.score,
      matchReasons: bestMatch.reasons,
      vehicleInfo: {
        year: bestMatch.vehicle.year,
        make: bestMatch.vehicle.make,
        model: bestMatch.vehicle.model
      }
    };
  }

  /**
   * Match multiple unorganized images in batch
   */
  static async matchImages(
    imageIds: string[],
    options: MatchOptions = {}
  ): Promise<ImageMatchResult[]> {
    const results: ImageMatchResult[] = [];

    for (const imageId of imageIds) {
      try {
        const match = await this.matchImage(imageId, options);
        if (match) {
          results.push(match);
        }
      } catch (error) {
        console.error(`Error matching image ${imageId}:`, error);
      }
    }

    return results;
  }

  /**
   * Auto-match all unorganized images for a user
   */
  static async matchUserUnorganizedImages(
    userId: string,
    options: MatchOptions = {}
  ): Promise<ImageMatchResult[]> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options, userId };

    // Get all unorganized images for user
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('user_id', userId)
      .is('vehicle_id', null)
      .eq('organization_status', 'unorganized')
      .order('created_at', { ascending: false });

    if (imagesError || !images || images.length === 0) {
      console.log('No unorganized images found');
      return [];
    }

    console.log(`Matching ${images.length} unorganized images...`);

    return this.matchImages(
      images.map(img => img.id),
      opts
    );
  }

  /**
   * Score how well an image matches a vehicle
   */
  private static async scoreVehicleMatch(
    image: any,
    vehicle: any,
    options: Required<MatchOptions>
  ): Promise<{ score: number; reasons: string[] }> {
    let score = 0;
    const reasons: string[] = [];

    // 1. GPS Location Match (40% weight)
    if (image.latitude && image.longitude) {
      const gpsScore = await this.scoreGpsMatch(
        image.latitude,
        image.longitude,
        vehicle.id,
        options.maxGpsDistanceMeters
      );
      if (gpsScore > 0) {
        score += gpsScore * 0.4;
        reasons.push(`GPS match: ${(gpsScore * 100).toFixed(0)}% (within ${options.maxGpsDistanceMeters}m)`);
      }
    }

    // 2. Date Proximity Match (30% weight)
    if (image.taken_at) {
      const dateScore = await this.scoreDateMatch(
        image.taken_at,
        vehicle.id,
        options.maxDateDifferenceDays
      );
      if (dateScore > 0) {
        score += dateScore * 0.3;
        reasons.push(`Date match: ${(dateScore * 100).toFixed(0)}% (within ${options.maxDateDifferenceDays} days)`);
      }
    }

    // 3. Filename Pattern Match (20% weight)
    if (image.filename) {
      const filenameScore = this.scoreFilenameMatch(image.filename, vehicle);
      if (filenameScore > 0) {
        score += filenameScore * 0.2;
        reasons.push(`Filename match: ${(filenameScore * 100).toFixed(0)}%`);
      }
    }

    // 4. EXIF Data Match (10% weight)
    if (image.exif_data) {
      const exifScore = this.scoreExifMatch(image.exif_data, vehicle);
      if (exifScore > 0) {
        score += exifScore * 0.1;
        reasons.push(`EXIF match: ${(exifScore * 100).toFixed(0)}%`);
      }
    }

    return { score: Math.min(1.0, score), reasons };
  }

  /**
   * Score GPS match: Check if image was taken near other images of this vehicle
   */
  private static async scoreGpsMatch(
    imageLat: number,
    imageLon: number,
    vehicleId: string,
    maxDistanceMeters: number
  ): Promise<number> {
    try {
      // Use RPC function for efficient PostGIS-based matching
      const { data: nearbyImages, error } = await supabase
        .rpc('find_images_near_location', {
          p_latitude: imageLat,
          p_longitude: imageLon,
          p_vehicle_id: vehicleId,
          p_max_distance_meters: maxDistanceMeters
        });

      if (error) {
        console.warn('RPC function not available, using fallback:', error);
        // Fallback: Manual distance calculation
        return this.scoreGpsMatchFallback(imageLat, imageLon, vehicleId, maxDistanceMeters);
      }

      if (!nearbyImages || nearbyImages.length === 0) {
        return 0;
      }

      // Calculate score based on count and minimum distance
      const count = nearbyImages.length;
      const minDistance = nearbyImages[0]?.distance_meters || maxDistanceMeters;

      // Score: distance factor (closer = better) + count factor (more images = better)
      const distanceScore = Math.max(0, 1 - (minDistance / maxDistanceMeters));
      const countScore = Math.min(1.0, count / 10); // Cap at 10 images
      
      return (distanceScore * 0.5) + (countScore * 0.5);
    } catch (error) {
      console.error('GPS match error:', error);
      return this.scoreGpsMatchFallback(imageLat, imageLon, vehicleId, maxDistanceMeters);
    }
  }

  /**
   * Fallback GPS matching using client-side distance calculation
   */
  private static async scoreGpsMatchFallback(
    imageLat: number,
    imageLon: number,
    vehicleId: string,
    maxDistanceMeters: number
  ): Promise<number> {
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('latitude, longitude')
      .eq('vehicle_id', vehicleId)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .limit(100);

    if (error || !images || images.length === 0) {
      return 0;
    }

    // Calculate distances and find closest
    let minDistance = Infinity;
    for (const img of images) {
      const distance = this.haversineDistance(
        imageLat,
        imageLon,
        img.latitude,
        img.longitude
      );
      minDistance = Math.min(minDistance, distance);
    }

    if (minDistance <= maxDistanceMeters) {
      // Score decreases with distance
      return Math.max(0, 1 - (minDistance / maxDistanceMeters));
    }

    return 0;
  }

  /**
   * Score date match: Check if image was taken around same time as other images
   */
  private static async scoreDateMatch(
    imageDate: string,
    vehicleId: string,
    maxDaysDifference: number
  ): Promise<number> {
    const imageTimestamp = new Date(imageDate).getTime();

    // Find images of this vehicle with taken_at dates
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('taken_at')
      .eq('vehicle_id', vehicleId)
      .not('taken_at', 'is', null)
      .limit(100);

    if (error || !images || images.length === 0) {
      return 0;
    }

    // Find closest date match
    let minDaysDifference = Infinity;
    for (const img of images) {
      if (!img.taken_at) continue;
      const imgTimestamp = new Date(img.taken_at).getTime();
      const daysDiff = Math.abs(imageTimestamp - imgTimestamp) / (1000 * 60 * 60 * 24);
      minDaysDifference = Math.min(minDaysDifference, daysDiff);
    }

    if (minDaysDifference <= maxDaysDifference) {
      // Score decreases with time difference
      return Math.max(0, 1 - (minDaysDifference / maxDaysDifference));
    }

    return 0;
  }

  /**
   * Score filename match: Check if filename contains vehicle identifiers
   */
  private static scoreFilenameMatch(filename: string, vehicle: any): number {
    if (!filename) return 0;

    const lowerFilename = filename.toLowerCase();
    let score = 0;

    // Check for year
    if (vehicle.year) {
      const yearStr = vehicle.year.toString();
      if (lowerFilename.includes(yearStr)) {
        score += 0.3;
      }
    }

    // Check for make
    if (vehicle.make) {
      const makeLower = vehicle.make.toLowerCase();
      if (lowerFilename.includes(makeLower)) {
        score += 0.3;
      }
    }

    // Check for model
    if (vehicle.model) {
      const modelLower = vehicle.model.toLowerCase();
      if (lowerFilename.includes(modelLower)) {
        score += 0.4;
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Score EXIF data match: Check if EXIF contains vehicle-related info
   */
  private static scoreExifMatch(exifData: any, vehicle: any): number {
    if (!exifData || typeof exifData !== 'object') return 0;

    let score = 0;

    // Check if EXIF location matches vehicle's known locations
    // (This could be enhanced with reverse geocoding)
    if (exifData.location?.city || exifData.location?.state) {
      score += 0.1; // Small boost for having location data
    }

    // Check if camera info suggests professional photography
    // (More likely to be organized photos)
    if (exifData.camera?.make && exifData.camera?.model) {
      score += 0.1;
    }

    return Math.min(1.0, score);
  }

  /**
   * Calculate distance between two GPS coordinates using Haversine formula
   */
  private static haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371000; // Earth radius in meters
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private static toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  /**
   * Apply matches to database (link images to vehicles)
   */
  static async applyMatches(matches: ImageMatchResult[]): Promise<{
    success: number;
    failed: number;
  }> {
    let success = 0;
    let failed = 0;

    for (const match of matches) {
      if (!match.vehicleId) continue;

      const { error } = await supabase
        .from('vehicle_images')
        .update({
          vehicle_id: match.vehicleId,
          organization_status: 'organized',
          organized_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', match.imageId);

      if (error) {
        console.error(`Failed to link image ${match.imageId}:`, error);
        failed++;
      } else {
        success++;
      }
    }

    return { success, failed };
  }
}

