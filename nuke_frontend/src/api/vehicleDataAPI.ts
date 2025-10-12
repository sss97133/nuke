// Vehicle Data Pipeline API
// Saves comprehensive AI-extracted vehicle data to database

import { supabase } from '../lib/supabase';

export interface VehicleProfileData {
  // Basic identification
  make: string;
  model: string;
  year: number;
  body_style?: string;
  trim?: string;
  generation?: string;
  color?: string;
  doors?: number;
  engine_type?: string;
  drivetrain?: string;
  cab_config?: string;
  bed_type?: string;
  
  // Value indicators from AI analysis
  condition_indicators?: {
    rust_severity?: number;
    rust_locations?: string[];
    paint_quality?: number;
    paint_type?: string;
    body_alignment?: number;
    chrome_condition?: number;
    glass_condition?: number;
    interior_wear?: number;
  };
  
  originality_factors?: {
    stock_appearance?: boolean;
    original_wheels?: boolean;
    engine_modifications?: string[];
    suspension_mods?: string[];
    exhaust_mods?: string[];
    interior_mods?: string[];
  };
  
  desirability_features?: {
    transmission_type?: string;
    special_packages?: string[];
    rare_options?: string[];
    performance_indicators?: string[];
  };
  
  red_flags?: {
    accident_damage?: string[];
    poor_repairs?: string[];
    rust_through?: string[];
    mismatched_panels?: string[];
    cheap_mods?: string[];
    missing_components?: string[];
  };
  
  rarity_indicators?: {
    special_badges?: string[];
    unusual_colors?: string[];
    limited_features?: string[];
    build_tags?: string[];
    production_numbers?: number;
  };
  
  value_assessment?: {
    condition_score?: number;
    originality_score?: number;
    rarity_score?: number;
    overall_value_tier?: 'project' | 'driver' | 'nice' | 'show' | 'concours';
    estimated_value_low?: number;
    estimated_value_high?: number;
    market_context?: string;
    assessment_confidence?: number;
  };
  
  // Analysis metadata
  user_context?: string;
  image_count?: number;
  analysis_confidence?: number;
  raw_ai_response?: any;
}

export interface MarketContextData {
  bring_a_trailer_url?: string;
  classics_com_url?: string;
  barrett_jackson_url?: string;
  recent_sales?: Array<{
    price: number;
    date: string;
    source: string;
    condition: string;
  }>;
  market_trend?: 'rising' | 'stable' | 'declining';
  collectibility_rating?: number;
}

export class VehicleDataAPI {
  
  /**
   * Create a complete vehicle profile from AI-extracted data
   */
  async createVehicleProfile(
    userId: string, 
    vehicleData: VehicleProfileData,
    marketContext?: MarketContextData
  ): Promise<{ vehicleId: string; success: boolean; error?: string }> {
    
    try {
      // 1. Create main vehicle record (using existing schema fields only)
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert({
          user_id: userId,
          make: vehicleData.make,
          model: vehicleData.model,
          year: vehicleData.year,
          trim: vehicleData.trim,
          color: vehicleData.color,
          engine: vehicleData.engine_type,
          transmission: vehicleData.desirability_features?.transmission_type,
          ownership_status: 'owned', // Default for user uploads
          tags: [
            ...(vehicleData.desirability_features?.special_packages || []),
            ...(vehicleData.rarity_indicators?.special_badges || [])
          ],
          // Store additional fields in private_notes for now
          private_notes: JSON.stringify({
            body_style: vehicleData.body_style,
            generation: vehicleData.generation,
            doors: vehicleData.doors,
            drivetrain: vehicleData.drivetrain,
            cab_config: vehicleData.cab_config,
            bed_type: vehicleData.bed_type,
            analysis_confidence: vehicleData.analysis_confidence,
            user_context: vehicleData.user_context
          })
        })
        .select()
        .single();

      if (vehicleError) {
        console.error('Vehicle creation error:', vehicleError);
        return { vehicleId: '', success: false, error: vehicleError.message };
      }

      const vehicleId = vehicle.id;

      // 2. Save condition indicators
      if (vehicleData.condition_indicators) {
        const { error: conditionError } = await supabase
          .from('vehicle_condition_indicators')
          .insert({
            vehicle_id: vehicleId,
            ...vehicleData.condition_indicators
          });
        
        if (conditionError) console.error('Condition indicators error:', conditionError);
      }

      // 3. Save originality factors
      if (vehicleData.originality_factors) {
        const { error: originalityError } = await supabase
          .from('vehicle_originality_factors')
          .insert({
            vehicle_id: vehicleId,
            ...vehicleData.originality_factors
          });
        
        if (originalityError) console.error('Originality factors error:', originalityError);
      }

      // 4. Save desirability features
      if (vehicleData.desirability_features) {
        const { error: desirabilityError } = await supabase
          .from('vehicle_desirability_features')
          .insert({
            vehicle_id: vehicleId,
            transmission_type: vehicleData.desirability_features.transmission_type,
            special_packages: vehicleData.desirability_features.special_packages,
            rare_options: vehicleData.desirability_features.rare_options,
            performance_indicators: vehicleData.desirability_features.performance_indicators
          });
        
        if (desirabilityError) console.error('Desirability features error:', desirabilityError);
      }

      // 5. Save red flags
      if (vehicleData.red_flags) {
        const { error: redFlagsError } = await supabase
          .from('vehicle_red_flags')
          .insert({
            vehicle_id: vehicleId,
            ...vehicleData.red_flags
          });
        
        if (redFlagsError) console.error('Red flags error:', redFlagsError);
      }

      // 6. Save rarity indicators
      if (vehicleData.rarity_indicators) {
        const { error: rarityError } = await supabase
          .from('vehicle_rarity_indicators')
          .insert({
            vehicle_id: vehicleId,
            ...vehicleData.rarity_indicators
          });
        
        if (rarityError) console.error('Rarity indicators error:', rarityError);
      }

      // 7. Save value assessment
      if (vehicleData.value_assessment) {
        const { error: valueError } = await supabase
          .from('vehicle_value_assessments')
          .insert({
            vehicle_id: vehicleId,
            ...vehicleData.value_assessment,
            assessed_by: 'ai_vision'
          });
        
        if (valueError) console.error('Value assessment error:', valueError);
      }

      // 8. Save analysis session
      const { error: sessionError } = await supabase
        .from('vehicle_analysis_sessions')
        .insert({
          vehicle_id: vehicleId,
          user_id: userId,
          image_count: vehicleData.image_count || 0,
          user_context: vehicleData.user_context,
          ai_model_version: 'gpt-4o',
          analysis_confidence: vehicleData.analysis_confidence || 0,
          raw_ai_response: vehicleData.raw_ai_response
        });
      
      if (sessionError) console.error('Analysis session error:', sessionError);

      // 9. Save market context if provided
      if (marketContext) {
        const { error: marketError } = await supabase
          .from('vehicle_market_context')
          .insert({
            vehicle_id: vehicleId,
            ...marketContext,
            recent_sales: marketContext.recent_sales
          });
        
        if (marketError) console.error('Market context error:', marketError);
      }

      return { vehicleId, success: true };

    } catch (error) {
      console.error('Vehicle profile creation failed:', error);
      return { 
        vehicleId: '', 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get comprehensive vehicle profile with all value indicators
   */
  async getVehicleProfile(vehicleId: string) {
    try {
      // Get main vehicle data
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (vehicleError) throw vehicleError;

      // Get all related value indicator tables
      const [
        conditionResult,
        originalityResult,
        desirabilityResult,
        redFlagsResult,
        rarityResult,
        valueResult,
        marketResult
      ] = await Promise.all([
        supabase.from('vehicle_condition_indicators').select('*').eq('vehicle_id', vehicleId).single(),
        supabase.from('vehicle_originality_factors').select('*').eq('vehicle_id', vehicleId).single(),
        supabase.from('vehicle_desirability_features').select('*').eq('vehicle_id', vehicleId).single(),
        supabase.from('vehicle_red_flags').select('*').eq('vehicle_id', vehicleId).single(),
        supabase.from('vehicle_rarity_indicators').select('*').eq('vehicle_id', vehicleId).single(),
        supabase.from('vehicle_value_assessments').select('*').eq('vehicle_id', vehicleId).single(),
        supabase.from('vehicle_market_context').select('*').eq('vehicle_id', vehicleId).single()
      ]);

      return {
        vehicle,
        condition_indicators: conditionResult.data,
        originality_factors: originalityResult.data,
        desirability_features: desirabilityResult.data,
        red_flags: redFlagsResult.data,
        rarity_indicators: rarityResult.data,
        value_assessment: valueResult.data,
        market_context: marketResult.data
      };

    } catch (error) {
      console.error('Failed to get vehicle profile:', error);
      throw error;
    }
  }

  /**
   * Search vehicles by value tier and characteristics
   */
  async searchVehiclesByValue(filters: {
    value_tier?: 'project' | 'driver' | 'nice' | 'show' | 'concours';
    make?: string;
    model?: string;
    year_min?: number;
    year_max?: number;
    condition_score_min?: number;
    originality_score_min?: number;
    rarity_score_min?: number;
  }) {
    try {
      let query = supabase
        .from('vehicles')
        .select(`
          *,
          vehicle_value_assessments(*)
        `);

      // Apply filters
      if (filters.make) query = query.eq('make', filters.make);
      if (filters.model) query = query.eq('model', filters.model);
      if (filters.year_min) query = query.gte('year', filters.year_min);
      if (filters.year_max) query = query.lte('year', filters.year_max);

      const { data, error } = await query;
      
      if (error) throw error;

      // Filter by value assessment criteria
      return data?.filter(vehicle => {
        const assessment = vehicle.vehicle_value_assessments?.[0];
        if (!assessment) return false;

        if (filters.value_tier && assessment.overall_value_tier !== filters.value_tier) return false;
        if (filters.condition_score_min && assessment.condition_score < filters.condition_score_min) return false;
        if (filters.originality_score_min && assessment.originality_score < filters.originality_score_min) return false;
        if (filters.rarity_score_min && assessment.rarity_score < filters.rarity_score_min) return false;

        return true;
      });

    } catch (error) {
      console.error('Vehicle search failed:', error);
      throw error;
    }
  }

  /**
   * Get market trends for similar vehicles
   */
  async getMarketTrends(make: string, model: string, yearRange: [number, number]) {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select(`
          year,
          vehicle_value_assessments(*),
          vehicle_market_context(*)
        `)
        .eq('make', make)
        .eq('model', model)
        .gte('year', yearRange[0])
        .lte('year', yearRange[1]);

      if (error) throw error;

      // Aggregate market data
      const trends = data?.map(vehicle => ({
        year: vehicle.year,
        value_tier: vehicle.vehicle_value_assessments?.[0]?.overall_value_tier,
        condition_score: vehicle.vehicle_value_assessments?.[0]?.condition_score,
        estimated_value: {
          low: vehicle.vehicle_value_assessments?.[0]?.estimated_value_low,
          high: vehicle.vehicle_value_assessments?.[0]?.estimated_value_high
        },
        market_trend: vehicle.vehicle_market_context?.[0]?.market_trend,
        collectibility: vehicle.vehicle_market_context?.[0]?.collectibility_rating
      }));

      return trends;

    } catch (error) {
      console.error('Market trends query failed:', error);
      throw error;
    }
  }
}

export const vehicleDataAPI = new VehicleDataAPI();
