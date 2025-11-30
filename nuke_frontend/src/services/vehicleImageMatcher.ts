/**
 * Vehicle Image Matcher Service
 * Matches vehicles by analyzing images for patina, damage, GPS, and timestamps
 */

import { supabase } from '../lib/supabase';

export interface ImageMatchEvidence {
  imageUrl: string;
  matchType: 'gps' | 'timestamp' | 'visual' | 'patina' | 'damage';
  confidence: number;
  details: string;
}

export interface VehicleMatchResult {
  vehicleId: string;
  matchScore: number;
  evidence: ImageMatchEvidence[];
  shouldMerge: boolean;
}

export class VehicleImageMatcher {
  /**
   * Match a listing to an existing vehicle by image analysis
   */
  async matchListingToVehicle(
    sourceVehicleId: string,
    listingUrl: string,
    userId: string
  ): Promise<VehicleMatchResult> {
    const { data, error } = await supabase.functions.invoke('match-vehicles-by-images', {
      body: {
        source_vehicle_id: sourceVehicleId,
        target_listing_url: listingUrl,
        user_id: userId
      }
    });

    if (error) throw error;

    return data;
  }

  /**
   * Find user's 1974 Blazer (or any vehicle by year/make/model)
   */
  async findVehicleBySpecs(
    year: number,
    make: string,
    model: string,
    userId: string
  ): Promise<string | null> {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id')
      .eq('year', year)
      .ilike('make', make)
      .ilike('model', model)
      .or(`user_id.eq.${userId},uploaded_by.eq.${userId}`)
      .limit(1);

    if (error || !vehicles || vehicles.length === 0) {
      return null;
    }

    return vehicles[0].id;
  }

  /**
   * Quick match: Check if listing matches user's vehicle
   */
  async quickMatch(
    listingUrl: string,
    userId: string,
    vehicleSpecs?: { year: number; make: string; model: string }
  ): Promise<VehicleMatchResult | null> {
    // If specs provided, find the vehicle first
    let sourceVehicleId: string | null = null;

    if (vehicleSpecs) {
      sourceVehicleId = await this.findVehicleBySpecs(
        vehicleSpecs.year,
        vehicleSpecs.make,
        vehicleSpecs.model,
        userId
      );
    }

    if (!sourceVehicleId) {
      // Could prompt user to select vehicle
      return null;
    }

    return await this.matchListingToVehicle(sourceVehicleId, listingUrl, userId);
  }
}

export const vehicleImageMatcher = new VehicleImageMatcher();

