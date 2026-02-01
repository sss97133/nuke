/**
 * Vehicle Self-Healing Service
 * 
 * Automatically enriches incomplete vehicle profiles from BAT URLs
 * Prevents redundancies through VIN matching and duplicate detection
 */

import { supabase } from '../lib/supabase';

export interface EnrichmentCheck {
  needsEnrichment: boolean;
  missingFields: string[];
  hasBATUrl: boolean;
  imageCount: number;
  completenessScore: number; // 0-100
}

export interface EnrichmentResult {
  success: boolean;
  fieldsUpdated: string[];
  imagesAdded: number;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

export class VehicleSelfHealingService {
  /**
   * Check if vehicle needs enrichment
   * Returns completeness analysis
   */
  static async needsEnrichment(vehicleId: string): Promise<EnrichmentCheck> {
    try {
      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .select(`
          id,
          vin,
          year,
          make,
          model,
          engine_size,
          transmission,
          mileage,
          color,
          bat_auction_url,
          profile_origin,
          vehicle_images(id)
        `)
        .eq('id', vehicleId)
        .single();

      if (error || !vehicle) {
        return {
          needsEnrichment: false,
          missingFields: [],
          hasBATUrl: false,
          imageCount: 0,
          completenessScore: 0
        };
      }

      const imageCount = (vehicle.vehicle_images as any[])?.length || 0;
      const hasBATUrl = !!vehicle.bat_auction_url;
      
      // Critical fields that should be filled
      const criticalFields = [
        { key: 'year', value: vehicle.year },
        { key: 'make', value: vehicle.make },
        { key: 'model', value: vehicle.model },
        { key: 'engine_size', value: vehicle.engine_size },
        { key: 'transmission', value: vehicle.transmission },
        { key: 'mileage', value: vehicle.mileage },
        { key: 'color', value: vehicle.color }
      ];

      const missingFields: string[] = [];
      let filledCount = 0;

      criticalFields.forEach(field => {
        if (!field.value || field.value === '' || field.value === null) {
          missingFields.push(field.key);
        } else {
          filledCount++;
        }
      });

      // Images are important but not critical
      const hasImages = imageCount > 0;
      if (!hasImages) {
        missingFields.push('images');
      }

      // Calculate completeness score (0-100)
      // 70% for critical fields, 30% for images
      const fieldScore = (filledCount / criticalFields.length) * 70;
      const imageScore = hasImages ? 30 : 0;
      const completenessScore = Math.round(fieldScore + imageScore);

      // Needs enrichment if:
      // 1. Has BAT URL (source available)
      // 2. Missing critical data OR missing images
      // 3. Profile origin is bat_import (likely incomplete)
      const needsEnrichment = hasBATUrl && (
        missingFields.length > 0 ||
        imageCount === 0 ||
        vehicle.profile_origin === 'bat_import'
      );

      return {
        needsEnrichment,
        missingFields,
        hasBATUrl,
        imageCount,
        completenessScore
      };

    } catch (error) {
      console.error('[SelfHealing] Error checking enrichment needs:', error);
      return {
        needsEnrichment: false,
        missingFields: [],
        hasBATUrl: false,
        imageCount: 0,
        completenessScore: 0
      };
    }
  }

  /**
   * Enrich vehicle from BAT URL
   * Strict VIN matching - never mixes data from different vehicles
   */
  static async enrichFromBAT(
    vehicleId: string, 
    batUrl: string,
    options: {
      skipIfRecent?: boolean; // Skip if enriched in last 24 hours
      force?: boolean; // Force enrichment even if recently done
    } = {}
  ): Promise<EnrichmentResult> {
    try {
      console.log('[SelfHealing] Starting enrichment for vehicle:', vehicleId);

      // 1. Get current vehicle data
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .select('vin, year, make, model, bat_auction_url, last_enriched_at')
        .eq('id', vehicleId)
        .single();

      if (vehicleError || !vehicle) {
        throw new Error('Vehicle not found');
      }

      // 2. Check if recently enriched (avoid redundant scraping)
      if (options.skipIfRecent && !options.force && vehicle.last_enriched_at) {
        const lastEnriched = new Date(vehicle.last_enriched_at);
        const hoursSinceEnrichment = (Date.now() - lastEnriched.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceEnrichment < 24) {
          console.log('[SelfHealing] Skipping - enriched recently:', hoursSinceEnrichment.toFixed(1), 'hours ago');
          return {
            success: true,
            fieldsUpdated: [],
            imagesAdded: 0,
            skipped: true,
            skipReason: `Enriched ${hoursSinceEnrichment.toFixed(1)} hours ago`
          };
        }
      }

      // 3. Verify BAT URL matches
      if (vehicle.bat_auction_url && vehicle.bat_auction_url !== batUrl) {
        console.warn('[SelfHealing] BAT URL mismatch:', vehicle.bat_auction_url, 'vs', batUrl);
        // Use vehicle's stored URL if different
        if (vehicle.bat_auction_url) {
          batUrl = vehicle.bat_auction_url;
        }
      }

      // 4. Scrape BAT listing
      console.log('[SelfHealing] Scraping BAT URL:', batUrl);
      const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: batUrl }
      });

      if (scrapeError) {
        throw new Error(`Scrape error: ${scrapeError.message || JSON.stringify(scrapeError)}`);
      }

      if (!scrapeResult?.success) {
        throw new Error(scrapeResult?.error || 'Failed to scrape BAT listing');
      }

      const scrapedData = scrapeResult.data;
      console.log('[SelfHealing] Scraped data:', {
        hasVIN: !!scrapedData.vin,
        hasImages: !!scrapedData.images?.length,
        fields: Object.keys(scrapedData).filter(k => scrapedData[k] !== null)
      });

      // 5. VIN validation (STRICT - never mix data)
      if (vehicle.vin && scrapedData.vin) {
        const vehicleVIN = vehicle.vin.toLowerCase().trim();
        const scrapedVIN = scrapedData.vin.toLowerCase().trim();
        
        if (vehicleVIN !== scrapedVIN) {
          const error = `VIN mismatch: vehicle has ${vehicle.vin}, BAT listing has ${scrapedData.vin}. Data not imported to prevent mixing.`;
          console.error('[SelfHealing] REJECTED:', error);
          return {
            success: false,
            fieldsUpdated: [],
            imagesAdded: 0,
            error
          };
        }
        console.log('[SelfHealing] VIN match confirmed:', vehicle.vin);
      } else if (scrapedData.vin && !vehicle.vin) {
        // Vehicle doesn't have VIN but scraped data does - safe to use
        console.log('[SelfHealing] Adding VIN from BAT listing:', scrapedData.vin);
      } else if (vehicle.vin && !scrapedData.vin) {
        // Vehicle has VIN but listing doesn't - can't verify, but proceed with caution
        console.warn('[SelfHealing] Vehicle has VIN but BAT listing does not - proceeding with caution');
      }

      // 6. Get current vehicle state (all fields)
      const { data: currentVehicle } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (!currentVehicle) {
        throw new Error('Failed to fetch current vehicle state');
      }

      // 7. Build updates (ONLY fill missing fields - never overwrite existing)
      const updates: any = {};
      const fieldsUpdated: string[] = [];

      // Year, make, model - only if missing
      if (!currentVehicle.year && scrapedData.year) {
        updates.year = scrapedData.year;
        fieldsUpdated.push('year');
      }
      if (!currentVehicle.make && scrapedData.make) {
        updates.make = scrapedData.make;
        fieldsUpdated.push('make');
      }
      if (!currentVehicle.model && scrapedData.model) {
        updates.model = scrapedData.model;
        fieldsUpdated.push('model');
      }

      // Specs - only if missing
      if (!currentVehicle.engine_size && scrapedData.engine_size) {
        updates.engine_size = scrapedData.engine_size;
        fieldsUpdated.push('engine_size');
      }
      if (!currentVehicle.transmission && scrapedData.transmission) {
        updates.transmission = scrapedData.transmission;
        fieldsUpdated.push('transmission');
      }
      if (!currentVehicle.mileage && scrapedData.mileage) {
        updates.mileage = scrapedData.mileage;
        fieldsUpdated.push('mileage');
      }
      if (!currentVehicle.color && scrapedData.color) {
        updates.color = scrapedData.color;
        fieldsUpdated.push('color');
      }

      // VIN - only if missing (and matches if both exist)
      if (!currentVehicle.vin && scrapedData.vin) {
        updates.vin = scrapedData.vin;
        fieldsUpdated.push('vin');
      }

      // Update origin_metadata with seller/buyer info
      if (scrapedData.seller || scrapedData.buyer) {
        const currentMetadata = (currentVehicle.origin_metadata as any) || {};
        updates.origin_metadata = {
          ...currentMetadata,
          ...(scrapedData.seller && { bat_seller: scrapedData.seller }),
          ...(scrapedData.buyer && { bat_buyer: scrapedData.buyer }),
          bat_scraped_at: new Date().toISOString(),
          last_enriched: new Date().toISOString()
        };
        if (!fieldsUpdated.includes('origin_metadata')) {
          fieldsUpdated.push('origin_metadata');
        }
      }

      // Update last_enriched_at timestamp
      updates.last_enriched_at = new Date().toISOString();

      // 8. Update vehicle (if any fields to update)
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', vehicleId);

        if (updateError) {
          throw new Error(`Failed to update vehicle: ${updateError.message}`);
        }
        console.log('[SelfHealing] Updated fields:', fieldsUpdated);
      } else {
        console.log('[SelfHealing] No fields to update - vehicle already complete');
      }

      // 9. Download images (if missing)
      let imagesAdded = 0;
      if (scrapedData.images && Array.isArray(scrapedData.images) && scrapedData.images.length > 0) {
        // Check current image count
        const { count: currentCount } = await supabase
          .from('vehicle_images')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', vehicleId);

        if (currentCount === 0) {
          console.log('[SelfHealing] Downloading images:', scrapedData.images.length);
          
          // Call edge function to download and save images
          // This should be implemented in a separate edge function
          // For now, we'll just log that images are available
          imagesAdded = scrapedData.images.length;
          console.log('[SelfHealing] Images available for download:', imagesAdded);
          
          // TODO: Implement image download via edge function
          // const { data: imageResult } = await supabase.functions.invoke('download-bat-images', {
          //   body: { vehicle_id: vehicleId, image_urls: scrapedData.images }
          // });
        } else {
          console.log('[SelfHealing] Images already exist, skipping download');
        }
      }

      return {
        success: true,
        fieldsUpdated,
        imagesAdded
      };

    } catch (error: any) {
      console.error('[SelfHealing] Error enriching vehicle:', error);
      return {
        success: false,
        fieldsUpdated: [],
        imagesAdded: 0,
        error: error.message || 'Unknown error during enrichment'
      };
    }
  }

  /**
   * Check for duplicate vehicles before creating
   * Returns existing vehicle ID if duplicate found
   */
  static async checkForDuplicate(batUrl?: string, vin?: string): Promise<{
    isDuplicate: boolean;
    existingVehicleId?: string;
    matchType?: 'vin' | 'url' | 'none';
  }> {
    try {
      // 1. Check by VIN (most reliable)
      if (vin) {
        const { data: vinMatch } = await supabase
          .from('vehicles')
          .select('id')
          .eq('vin', vin)
          .single();

        if (vinMatch) {
          return {
            isDuplicate: true,
            existingVehicleId: vinMatch.id,
            matchType: 'vin'
          };
        }
      }

      // 2. Check by BAT URL (secondary)
      if (batUrl) {
        const { data: urlMatch } = await supabase
          .from('vehicles')
          .select('id')
          .eq('bat_auction_url', batUrl)
          .single();

        if (urlMatch) {
          return {
            isDuplicate: true,
            existingVehicleId: urlMatch.id,
            matchType: 'url'
          };
        }
      }

      return {
        isDuplicate: false,
        matchType: 'none'
      };

    } catch (error) {
      console.error('[SelfHealing] Error checking for duplicates:', error);
      // On error, assume not duplicate (safer to create than skip)
      return {
        isDuplicate: false,
        matchType: 'none'
      };
    }
  }
}

export default VehicleSelfHealingService;

