/**
 * Image Duplicate Linker Service
 * 
 * Images are KEYS - they can unlock connections to existing data.
 * 
 * When a user uploads an image without linking to a vehicle:
 * 1. Check filename against existing images in DB
 * 2. Compare EXIF data (camera, date, GPS)
 * 3. If match found → this image relates to an existing vehicle
 * 4. Create service relationship between uploader's org and vehicle
 * 
 * This enables forensic discovery: "This shop has photos of this vehicle,
 * therefore they likely worked on it"
 */

import { supabase } from '../lib/supabase';

interface DuplicateMatch {
  originalImageId: string;
  vehicleId: string;
  vehicleInfo: {
    year: number;
    make: string;
    model: string;
  };
  matchConfidence: number;
  matchReasons: string[];
}

interface LinkResult {
  isDuplicate: boolean;
  match?: DuplicateMatch;
  serviceRelationshipCreated: boolean;
  error?: string;
}

export class ImageDuplicateLinker {
  
  /**
   * Check if an uploaded image is a duplicate and link to existing vehicle
   * Call this after upload when no vehicle was specified
   */
  static async checkAndLinkDuplicate(
    imageId: string,
    filename: string,
    exifData: any,
    uploaderId: string,
    uploaderOrgId?: string
  ): Promise<LinkResult> {
    try {
      console.log(`🔑 [DuplicateLinker] Checking image "${filename}" for duplicates...`);

      // SAFETY: Cross-vehicle contamination is unacceptable.
      // Only auto-link when we have a true image-identity match (hash-based).
      // Filename/EXIF similarity can collide across vehicles and must never auto-assign vehicle_id.
      const matches = await this.findByHashSignature(imageId);
      
      if (matches.length === 0) {
        console.log(`🔑 [DuplicateLinker] No duplicates found for "${filename}"`);
        return { isDuplicate: false, serviceRelationshipCreated: false };
      }
      
      // 3. Pick best match
      const bestMatch = matches[0];
      console.log(`🔑 [DuplicateLinker] Found duplicate! Vehicle: ${bestMatch.vehicleInfo.year} ${bestMatch.vehicleInfo.make} ${bestMatch.vehicleInfo.model}`);
      
      // 4. Update the new image to point to the same vehicle
      await supabase
        .from('vehicle_images')
        .update({
          vehicle_id: bestMatch.vehicleId,
          suggested_vehicle_id: bestMatch.vehicleId,
          duplicate_of: bestMatch.originalImageId,
          is_duplicate: true,
          organization_status: 'organized'
        })
        .eq('id', imageId);
      
      // 5. If uploader has an org, create service relationship
      let serviceRelationshipCreated = false;
      if (uploaderOrgId) {
        serviceRelationshipCreated = await this.createServiceRelationship(
          bestMatch.vehicleId,
          uploaderOrgId,
          uploaderId,
          'duplicate_image_match'
        );
      }
      
      return {
        isDuplicate: true,
        match: bestMatch,
        serviceRelationshipCreated
      };
      
    } catch (error: any) {
      console.error('🔑 [DuplicateLinker] Error:', error);
      return { isDuplicate: false, serviceRelationshipCreated: false, error: error.message };
    }
  }
  
  /**
   * Find existing images with same filename
   * NOTE: This is intentionally NOT used for auto-linking due to cross-vehicle contamination risk.
   */
  private static async findByFilename(
    filename: string,
    excludeImageId: string
  ): Promise<DuplicateMatch[]> {
    // Normalize filename (remove path, lowercase)
    const normalizedFilename = filename.split('/').pop()?.toLowerCase() || filename.toLowerCase();
    
    const { data, error } = await supabase
      .from('vehicle_images')
      .select(`
        id,
        vehicle_id,
        filename,
        exif_data,
        vehicles!inner (
          id, year, make, model
        )
      `)
      .neq('id', excludeImageId)
      .not('vehicle_id', 'is', null)
      .ilike('filename', `%${normalizedFilename}%`)
      .limit(10);
    
    if (error || !data) return [];
    
    return data.map(img => ({
      originalImageId: img.id,
      vehicleId: img.vehicle_id,
      vehicleInfo: {
        year: img.vehicles?.year || 0,
        make: img.vehicles?.make || 'Unknown',
        model: img.vehicles?.model || 'Unknown'
      },
      matchConfidence: 0.9, // High confidence for filename match
      matchReasons: ['Filename match']
    }));
  }
  
  /**
   * Find existing images with matching EXIF signature
   * (same camera, same timestamp, similar GPS)
   * NOTE: This is intentionally NOT used for auto-linking due to cross-vehicle contamination risk.
   */
  private static async findByExifSignature(
    exifData: any,
    excludeImageId: string
  ): Promise<DuplicateMatch[]> {
    const matches: DuplicateMatch[] = [];
    
    // Extract key EXIF fields
    const cameraMake = exifData?.Make || exifData?.make;
    const cameraModel = exifData?.Model || exifData?.model;
    const dateTime = exifData?.DateTimeOriginal || exifData?.datetime;
    const gps = exifData?.GPS || exifData?.gps;
    
    if (!dateTime && !gps) {
      return []; // Need at least date or GPS to match
    }
    
    // Build query for potential matches
    let query = supabase
      .from('vehicle_images')
      .select(`
        id,
        vehicle_id,
        filename,
        taken_at,
        latitude,
        longitude,
        exif_data,
        vehicles!inner (
          id, year, make, model
        )
      `)
      .neq('id', excludeImageId)
      .not('vehicle_id', 'is', null);
    
    // If we have a date, find images within same minute
    if (dateTime) {
      const date = new Date(dateTime);
      const startOfMinute = new Date(date);
      startOfMinute.setSeconds(0, 0);
      const endOfMinute = new Date(startOfMinute);
      endOfMinute.setMinutes(endOfMinute.getMinutes() + 1);
      
      query = query
        .gte('taken_at', startOfMinute.toISOString())
        .lt('taken_at', endOfMinute.toISOString());
    }
    
    const { data, error } = await query.limit(50);
    
    if (error || !data) return [];
    
    // Score each potential match
    for (const img of data) {
      const matchReasons: string[] = [];
      let confidence = 0;
      
      // Check camera match
      const imgExif = img.exif_data || {};
      if (cameraMake && imgExif.Make === cameraMake) {
        confidence += 0.2;
        matchReasons.push('Same camera make');
      }
      if (cameraModel && imgExif.Model === cameraModel) {
        confidence += 0.2;
        matchReasons.push('Same camera model');
      }
      
      // Check timestamp match (already filtered by query, but verify)
      if (dateTime && img.taken_at) {
        confidence += 0.3;
        matchReasons.push('Same timestamp');
      }
      
      // Check GPS match
      if (gps && img.latitude && img.longitude) {
        const distance = this.calculateDistance(
          gps.latitude || gps.lat,
          gps.longitude || gps.lng,
          img.latitude,
          img.longitude
        );
        if (distance < 100) { // Within 100 meters
          confidence += 0.3;
          matchReasons.push(`GPS match (${Math.round(distance)}m)`);
        }
      }
      
      if (confidence >= 0.5) {
        matches.push({
          originalImageId: img.id,
          vehicleId: img.vehicle_id,
          vehicleInfo: {
            year: img.vehicles?.year || 0,
            make: img.vehicles?.make || 'Unknown',
            model: img.vehicles?.model || 'Unknown'
          },
          matchConfidence: confidence,
          matchReasons
        });
      }
    }
    
    // Sort by confidence
    return matches.sort((a, b) => b.matchConfidence - a.matchConfidence);
  }

  /**
   * Find duplicates by true identity: file/perceptual/dhash match.
   * This is the ONLY safe basis for auto-linking images across vehicles.
   */
  private static async findByHashSignature(imageId: string): Promise<DuplicateMatch[]> {
    const { data: img, error: imgErr } = await supabase
      .from('vehicle_images')
      .select('id, file_hash, perceptual_hash, dhash')
      .eq('id', imageId)
      .maybeSingle();

    if (imgErr || !img) return [];

    const fileHash = img.file_hash || null;
    const pHash = img.perceptual_hash || null;
    const dHash = img.dhash || null;

    // If we don't have any hashes, we cannot safely auto-link.
    if (!fileHash && !pHash && !dHash) return [];

    // Build OR filter across available hashes.
    const orParts: string[] = [];
    if (fileHash) orParts.push(`file_hash.eq.${fileHash}`);
    if (pHash) orParts.push(`perceptual_hash.eq.${pHash}`);
    if (dHash) orParts.push(`dhash.eq.${dHash}`);

    if (orParts.length === 0) return [];

    const { data, error } = await supabase
      .from('vehicle_images')
      .select(`
        id,
        vehicle_id,
        vehicles!inner ( id, year, make, model )
      `)
      .neq('id', imageId)
      .not('vehicle_id', 'is', null)
      .or(orParts.join(','))
      .limit(10);

    if (error || !data) return [];

    return data.map((row: any) => ({
      originalImageId: row.id,
      vehicleId: row.vehicle_id,
      vehicleInfo: {
        year: row.vehicles?.year || 0,
        make: row.vehicles?.make || 'Unknown',
        model: row.vehicles?.model || 'Unknown'
      },
      matchConfidence: 1.0,
      matchReasons: ['Hash match']
    }));
  }
  
  /**
   * Create or update service relationship between org and vehicle
   */
  private static async createServiceRelationship(
    vehicleId: string,
    organizationId: string,
    userId: string,
    source: string
  ): Promise<boolean> {
    try {
      // Check if relationship already exists
      const { data: existing } = await supabase
        .from('organization_vehicles')
        .select('id, relationship_type')
        .eq('vehicle_id', vehicleId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      
      if (existing) {
        // Update existing - might want to change status to active
        await supabase
          .from('organization_vehicles')
          .update({
            status: 'active',
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        
        console.log(`🔑 [DuplicateLinker] Updated existing service relationship`);
        return true;
      }
      
      // Create new relationship
      const { error } = await supabase
        .from('organization_vehicles')
        .insert({
          vehicle_id: vehicleId,
          organization_id: organizationId,
          relationship_type: 'service_provider',
          status: 'active',
          auto_tagged: true,
          linked_by_user_id: userId,
          start_date: new Date().toISOString().split('T')[0],
          notes: `Auto-linked via ${source}`
        });
      
      if (error) {
        console.error('Failed to create service relationship:', error);
        return false;
      }
      
      console.log(`🔑 [DuplicateLinker] Created new service relationship`);
      return true;
      
    } catch (err) {
      console.error('Error creating service relationship:', err);
      return false;
    }
  }
  
  /**
   * Calculate distance between two GPS coordinates in meters
   */
  private static calculateDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number
  ): number {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }
  
  /**
   * Batch process unorganized images to find duplicates
   * Call this periodically or on-demand
   */
  static async processUnorganizedImages(
    userId: string,
    userOrgId?: string,
    limit: number = 100
  ): Promise<{ processed: number; linked: number }> {
    console.log(`🔑 [DuplicateLinker] Processing unorganized images for user ${userId}...`);
    
    // Get unorganized images for this user
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('id, filename, exif_data')
      .eq('user_id', userId)
      .is('vehicle_id', null)
      .eq('organization_status', 'unorganized')
      .limit(limit);
    
    if (error || !images) {
      console.error('Failed to fetch unorganized images:', error);
      return { processed: 0, linked: 0 };
    }
    
    let processed = 0;
    let linked = 0;
    
    for (const img of images) {
      const result = await this.checkAndLinkDuplicate(
        img.id,
        img.filename || '',
        img.exif_data,
        userId,
        userOrgId
      );
      
      processed++;
      if (result.isDuplicate) {
        linked++;
      }
    }
    
    console.log(`🔑 [DuplicateLinker] Processed ${processed} images, linked ${linked} to vehicles`);
    return { processed, linked };
  }
}

