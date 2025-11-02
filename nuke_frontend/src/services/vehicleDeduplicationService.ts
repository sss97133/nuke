/**
 * Vehicle Deduplication Service
 * Detects and merges duplicate vehicle profiles
 */

import { supabase } from '../lib/supabase';

interface DuplicateMatch {
  existingVehicle: any;
  newVehicle: any;
  matchType: 'vin_exact' | 'year_make_model' | 'fuzzy';
  confidence: number;
  shouldMerge: boolean;
}

export class VehicleDeduplicationService {
  /**
   * Find potential duplicates for a vehicle
   */
  static async findDuplicates(vehicle: {
    vin?: string;
    year?: number;
    make?: string;
    model?: string;
  }): Promise<DuplicateMatch[]> {
    const matches: DuplicateMatch[] = [];

    // 1. VIN exact match (highest confidence)
    if (vehicle.vin && vehicle.vin.length >= 11 && !vehicle.vin.startsWith('VIVA-')) {
      const { data: vinMatches } = await supabase
        .from('vehicles')
        .select('*')
        .eq('vin', vehicle.vin);

      if (vinMatches && vinMatches.length > 0) {
        vinMatches.forEach(existing => {
          matches.push({
            existingVehicle: existing,
            newVehicle: vehicle,
            matchType: 'vin_exact',
            confidence: 100,
            shouldMerge: true
          });
        });
        return matches; // VIN match is definitive, no need to check further
      }
    }

    // 2. Year + Make + Model exact match
    if (vehicle.year && vehicle.make && vehicle.model) {
      const { data: ymmMatches } = await supabase
        .from('vehicles')
        .select('*')
        .eq('year', vehicle.year)
        .ilike('make', vehicle.make)
        .ilike('model', vehicle.model);

      if (ymmMatches && ymmMatches.length > 0) {
        ymmMatches.forEach(existing => {
          // Skip if this vehicle already has a real VIN
          if (existing.vin && existing.vin.length > 11 && !existing.vin.startsWith('VIVA-')) {
            return; // Different vehicle with real VIN
          }

          matches.push({
            existingVehicle: existing,
            newVehicle: vehicle,
            matchType: 'year_make_model',
            confidence: 85,
            shouldMerge: false // Needs manual review
          });
        });
      }
    }

    // 3. Fuzzy match (similar make/model, close year)
    if (vehicle.year && vehicle.make && vehicle.model) {
      const { data: fuzzyMatches } = await supabase
        .from('vehicles')
        .select('*')
        .gte('year', vehicle.year - 1)
        .lte('year', vehicle.year + 1)
        .ilike('make', `%${vehicle.make.substring(0, 4)}%`);

      if (fuzzyMatches && fuzzyMatches.length > 0) {
        fuzzyMatches.forEach(existing => {
          // Skip exact matches already found
          if (matches.some(m => m.existingVehicle.id === existing.id)) {
            return;
          }

          // Check model similarity
          const modelSimilarity = this.stringSimilarity(
            vehicle.model?.toLowerCase() || '',
            existing.model?.toLowerCase() || ''
          );

          if (modelSimilarity > 0.7) {
            matches.push({
              existingVehicle: existing,
              newVehicle: vehicle,
              matchType: 'fuzzy',
              confidence: Math.round(modelSimilarity * 100),
              shouldMerge: false
            });
          }
        });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Merge two vehicle profiles
   * Combines data from both, preferring more complete/accurate data
   */
  static async mergeVehicles(
    keepVehicleId: string,
    mergeVehicleId: string,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get both vehicles
      const [keep, merge] = await Promise.all([
        supabase.from('vehicles').select('*').eq('id', keepVehicleId).single(),
        supabase.from('vehicles').select('*').eq('id', mergeVehicleId).single()
      ]);

      if (keep.error || merge.error) {
        throw new Error('Vehicle not found');
      }

      // Merge data (prefer more complete values)
      const mergedData: any = {
        // Always prefer real VIN over VIVA-placeholder
        vin: this.preferRealVIN(keep.data.vin, merge.data.vin),
        // Prefer non-null values
        trim: keep.data.trim || merge.data.trim,
        color: keep.data.color || merge.data.color,
        mileage: keep.data.mileage || merge.data.mileage,
        // Prefer higher value (more recent/accurate)
        current_value: Math.max(keep.data.current_value || 0, merge.data.current_value || 0),
        sale_price: keep.data.sale_price || merge.data.sale_price,
        purchase_price: keep.data.purchase_price || merge.data.purchase_price,
        // Combine notes/descriptions
        description: this.combineText(keep.data.description, merge.data.description),
        notes: this.combineText(keep.data.notes, merge.data.notes)
      };

      // Update the vehicle we're keeping
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(mergedData)
        .eq('id', keepVehicleId);

      if (updateError) throw updateError;

      // Move all related data from merge vehicle to keep vehicle
      await Promise.all([
        // Move images
        supabase.from('vehicle_images')
          .update({ vehicle_id: keepVehicleId })
          .eq('vehicle_id', mergeVehicleId),
        
        // Move timeline events  
        supabase.rpc('update_timeline_vehicle_id', {
          old_vehicle_id: mergeVehicleId,
          new_vehicle_id: keepVehicleId
        }),
        
        // Move organization links
        supabase.from('organization_vehicles')
          .update({ vehicle_id: keepVehicleId })
          .eq('vehicle_id', mergeVehicleId),
        
        // Move contractor work
        supabase.from('contractor_work_contributions')
          .update({ vehicle_id: keepVehicleId })
          .eq('vehicle_id', mergeVehicleId),
        
        // Move comments/interactions
        supabase.from('vehicle_comments')
          .update({ vehicle_id: keepVehicleId })
          .eq('vehicle_id', mergeVehicleId)
      ]);

      // Soft delete the merged vehicle
      await supabase
        .from('vehicles')
        .update({ 
          deleted_at: new Date().toISOString(),
          notes: `Merged into ${keepVehicleId} by user ${userId}`
        })
        .eq('id', mergeVehicleId);

      return { success: true };
    } catch (error: any) {
      console.error('Merge error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Helper: Prefer real VIN over placeholder
   */
  private static preferRealVIN(vin1?: string, vin2?: string): string {
    if (!vin1 && !vin2) return '';
    if (!vin1) return vin2 || '';
    if (!vin2) return vin1;
    
    // Prefer non-VIVA placeholder
    if (vin1.startsWith('VIVA-') && !vin2.startsWith('VIVA-')) return vin2;
    if (vin2.startsWith('VIVA-') && !vin1.startsWith('VIVA-')) return vin1;
    
    // Prefer longer VIN (more complete)
    return vin1.length >= vin2.length ? vin1 : vin2;
  }

  /**
   * Helper: Combine text fields
   */
  private static combineText(text1?: string, text2?: string): string | null {
    if (!text1 && !text2) return null;
    if (!text1) return text2 || null;
    if (!text2) return text1;
    if (text1 === text2) return text1;
    return `${text1}\n\n---\n\n${text2}`;
  }

  /**
   * Helper: String similarity (Levenshtein distance based)
   */
  private static stringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Helper: Levenshtein distance
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Batch check for duplicates when importing multiple vehicles
   */
  static async batchCheckDuplicates(vehicles: any[]): Promise<Map<number, DuplicateMatch[]>> {
    const results = new Map<number, DuplicateMatch[]>();

    for (let i = 0; i < vehicles.length; i++) {
      const matches = await this.findDuplicates(vehicles[i]);
      if (matches.length > 0) {
        results.set(i, matches);
      }
    }

    return results;
  }
}

