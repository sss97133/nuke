/**
 * Vehicle Data Normalization Service
 * 
 * Handles normalizing existing vehicle data to use standardized make/model names.
 * Can be used for backfilling existing records or real-time normalization.
 */

import { supabase } from '../lib/supabase';
import VehicleMakeModelService from './vehicleMakeModelService';

export interface NormalizationResult {
  vehicleId: string;
  originalMake: string;
  originalModel: string;
  normalizedMake: string | null;
  normalizedModel: string | null;
  confidence: 'high' | 'medium' | 'low' | 'failed';
  requiresManualReview: boolean;
  suggestions?: Array<{
    make: string;
    model: string;
    confidence: number;
  }>;
}

export interface NormalizationStats {
  totalVehicles: number;
  processed: number;
  normalized: number;
  failed: number;
  requiresReview: number;
  errors: string[];
}

export class VehicleDataNormalizationService {
  
  /**
   * Normalize a single vehicle's make/model data
   */
  static normalizeVehicleData(make: string, model: string): NormalizationResult {
    const result: NormalizationResult = {
      vehicleId: '',
      originalMake: make,
      originalModel: model,
      normalizedMake: null,
      normalizedModel: null,
      confidence: 'failed',
      requiresManualReview: false,
      suggestions: []
    };

    // Normalize make
    const normalizedMake = VehicleMakeModelService.normalizeMake(make);
    if (!normalizedMake) {
      result.confidence = 'failed';
      result.requiresManualReview = true;
      
      // Try to provide suggestions
      const makeSuggestions = VehicleMakeModelService.searchMakes(make, 3);
      if (makeSuggestions.length > 0) {
        result.suggestions = makeSuggestions.map(m => ({
          make: m.name,
          model: '',
          confidence: 0.7
        }));
      }
      
      return result;
    }

    result.normalizedMake = normalizedMake;

    // Find make object to get ID
    const makeObj = VehicleMakeModelService.getAllMakes().find(m => m.name === normalizedMake);
    if (!makeObj) {
      result.confidence = 'failed';
      result.requiresManualReview = true;
      return result;
    }

    // Normalize model
    const normalizedModel = VehicleMakeModelService.normalizeModel(makeObj.id, model);
    if (!normalizedModel) {
      result.confidence = 'low';
      result.requiresManualReview = true;
      
      // Try to provide model suggestions
      const modelSuggestions = VehicleMakeModelService.searchModels(makeObj.id, model, 3);
      if (modelSuggestions.length > 0) {
        result.suggestions = modelSuggestions.map(m => ({
          make: normalizedMake,
          model: m.name,
          confidence: 0.6
        }));
      }
      
      return result;
    }

    result.normalizedModel = normalizedModel;

    // Determine confidence level
    if (make.toLowerCase() === normalizedMake.toLowerCase() && 
        model.toLowerCase() === normalizedModel.toLowerCase()) {
      result.confidence = 'high';
    } else if (make.toLowerCase().includes(normalizedMake.toLowerCase()) || 
               normalizedMake.toLowerCase().includes(make.toLowerCase())) {
      result.confidence = 'medium';
    } else {
      result.confidence = 'low';
      result.requiresManualReview = true;
    }

    return result;
  }

  /**
   * Analyze all vehicles in the database for normalization opportunities
   */
  static async analyzeVehicleData(): Promise<{
    totalVehicles: number;
    needsNormalization: NormalizationResult[];
    stats: {
      exactMatches: number;
      canNormalize: number;
      needsReview: number;
      failed: number;
    };
  }> {
    try {
      // Fetch all vehicles with make/model data
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, make, model')
        .not('make', 'is', null)
        .not('model', 'is', null);

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      const results: NormalizationResult[] = [];
      const stats = {
        exactMatches: 0,
        canNormalize: 0,
        needsReview: 0,
        failed: 0
      };

      vehicles?.forEach(vehicle => {
        const result = this.normalizeVehicleData(vehicle.make, vehicle.model);
        result.vehicleId = vehicle.id;

        // Skip vehicles that are already normalized
        if (result.confidence === 'high' && 
            vehicle.make === result.normalizedMake && 
            vehicle.model === result.normalizedModel) {
          stats.exactMatches++;
          return;
        }

        results.push(result);

        // Update stats
        if (result.confidence === 'failed') {
          stats.failed++;
        } else if (result.requiresManualReview) {
          stats.needsReview++;
        } else {
          stats.canNormalize++;
        }
      });

      return {
        totalVehicles: vehicles?.length || 0,
        needsNormalization: results,
        stats
      };
    } catch (error) {
      console.error('Error analyzing vehicle data:', error);
      throw error;
    }
  }

  /**
   * Perform bulk normalization of vehicle data
   */
  static async normalizeAllVehicles(
    dryRun: boolean = true,
    onProgress?: (progress: NormalizationStats) => void
  ): Promise<NormalizationStats> {
    const stats: NormalizationStats = {
      totalVehicles: 0,
      processed: 0,
      normalized: 0,
      failed: 0,
      requiresReview: 0,
      errors: []
    };

    try {
      const analysis = await this.analyzeVehicleData();
      stats.totalVehicles = analysis.totalVehicles;

      const toNormalize = analysis.needsNormalization.filter(
        result => !result.requiresManualReview && result.normalizedMake && result.normalizedModel
      );

      console.log(`Found ${toNormalize.length} vehicles that can be auto-normalized`);

      for (const result of toNormalize) {
        try {
          if (!dryRun) {
            // Update the vehicle in the database
            const { error } = await supabase
              .from('vehicles')
              .update({
                make: result.normalizedMake,
                model: result.normalizedModel,
                updated_at: new Date().toISOString()
              })
              .eq('id', result.vehicleId);

            if (error) {
              stats.errors.push(`Vehicle ${result.vehicleId}: ${error.message}`);
              stats.failed++;
            } else {
              stats.normalized++;
            }
          } else {
            // Dry run - just count what would be normalized
            stats.normalized++;
          }

          stats.processed++;
          
          // Call progress callback
          if (onProgress) {
            onProgress({ ...stats });
          }

        } catch (error) {
          const errorMsg = `Vehicle ${result.vehicleId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          stats.errors.push(errorMsg);
          stats.failed++;
        }
      }

      // Count vehicles that require manual review
      stats.requiresReview = analysis.needsNormalization.filter(
        result => result.requiresManualReview
      ).length;

      return stats;
    } catch (error) {
      const errorMsg = `Bulk normalization error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      stats.errors.push(errorMsg);
      throw error;
    }
  }

  /**
   * Get vehicles that require manual review
   */
  static async getVehiclesRequiringReview(): Promise<Array<{
    vehicle: any;
    normalizationResult: NormalizationResult;
  }>> {
    try {
      const analysis = await this.analyzeVehicleData();
      const needsReview = analysis.needsNormalization.filter(
        result => result.requiresManualReview
      );

      // Fetch full vehicle data for review
      const vehicleIds = needsReview.map(r => r.vehicleId);
      
      if (vehicleIds.length === 0) {
        return [];
      }

      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('*')
        .in('id', vehicleIds);

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      return vehicles?.map(vehicle => {
        const normalizationResult = needsReview.find(r => r.vehicleId === vehicle.id);
        return {
          vehicle,
          normalizationResult: normalizationResult!
        };
      }) || [];
    } catch (error) {
      console.error('Error getting vehicles for review:', error);
      throw error;
    }
  }

  /**
   * Manually approve a normalization suggestion
   */
  static async approveNormalization(
    vehicleId: string,
    normalizedMake: string,
    normalizedModel: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({
          make: normalizedMake,
          model: normalizedModel,
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicleId);

      if (error) {
        console.error('Error approving normalization:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error approving normalization:', error);
      return false;
    }
  }

  /**
   * Get normalization statistics
   */
  static async getNormalizationStats(): Promise<{
    total: number;
    normalized: number;
    needsReview: number;
    failed: number;
    percentage: number;
  }> {
    try {
      const analysis = await this.analyzeVehicleData();
      
      const normalized = analysis.stats.exactMatches + analysis.stats.canNormalize;
      const needsReview = analysis.stats.needsReview;
      const failed = analysis.stats.failed;
      const total = analysis.totalVehicles;
      
      return {
        total,
        normalized,
        needsReview,
        failed,
        percentage: total > 0 ? Math.round((normalized / total) * 100) : 0
      };
    } catch (error) {
      console.error('Error getting normalization stats:', error);
      return {
        total: 0,
        normalized: 0,
        needsReview: 0,
        failed: 0,
        percentage: 0
      };
    }
  }
}
