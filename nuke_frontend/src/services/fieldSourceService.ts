import { supabase } from '../lib/supabase';

export type DataSourceType = 
  | 'human_input'
  | 'ai_scan'
  | 'ai_recognition'
  | 'ai_suggestion'
  | 'bulk_import'
  | 'api_lookup'
  | 'inherited'
  | 'system_default';

export interface FieldSource {
  id: string;
  vehicle_id: string;
  field_name: string;
  field_value: string;
  source_type: DataSourceType;
  confidence_score: number;
  input_timestamp: string;
  user_id: string;
  source_metadata: Record<string, any>;
  is_verified: boolean;
  verified_by?: string;
  verified_at?: string;
  created_at: string;
  updated_at: string;
}

export interface FieldSourceSummary {
  source_type: DataSourceType;
  field_count: number;
  percentage: number;
}

export class FieldSourceService {
  /**
   * Track the source of a field value (human input vs AI)
   */
  static async trackFieldSource(
    vehicleId: string,
    fieldName: string,
    fieldValue: string,
    sourceType: DataSourceType,
    options: {
      confidenceScore?: number;
      sourceMetadata?: Record<string, any>;
      userId?: string;
    } = {}
  ): Promise<string | null> {
    try {
      const { data, error } = await supabase.rpc('upsert_field_source', {
        p_vehicle_id: vehicleId,
        p_field_name: fieldName,
        p_field_value: fieldValue,
        p_source_type: sourceType,
        p_confidence_score: options.confidenceScore || 1.0,
        p_user_id: options.userId || null,
        p_source_metadata: options.sourceMetadata || {}
      });

      if (error) {
        console.error('Error tracking field source:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in trackFieldSource:', error);
      return null;
    }
  }

  /**
   * Track multiple field sources at once (for bulk operations)
   */
  static async trackMultipleFieldSources(
    vehicleId: string,
    fields: Array<{
      fieldName: string;
      fieldValue: string;
      sourceType: DataSourceType;
      confidenceScore?: number;
      sourceMetadata?: Record<string, any>;
    }>,
    userId?: string
  ): Promise<boolean> {
    try {
      const promises = fields.map(field =>
        this.trackFieldSource(
          vehicleId,
          field.fieldName,
          field.fieldValue,
          field.sourceType,
          {
            confidenceScore: field.confidenceScore,
            sourceMetadata: field.sourceMetadata,
            userId
          }
        )
      );

      await Promise.all(promises);
      return true;
    } catch (error) {
      console.error('Error tracking multiple field sources:', error);
      return false;
    }
  }

  /**
   * Get human verification percentage for a vehicle
   */
  static async getHumanVerificationPercentage(vehicleId: string): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('get_human_verification_percentage', {
        p_vehicle_id: vehicleId
      });

      if (error) {
        // Missing RPCs in some environments: return safe default quietly
        if ((error as any)?.code === 'PGRST202') return 0;
        console.warn('Warning: get_human_verification_percentage unavailable. Defaulting to 0. Details:', error);
        return 0;
      }

      return data || 0;
    } catch (error) {
      console.error('Error in getHumanVerificationPercentage:', error);
      return 0;
    }
  }

  /**
   * Get field source summary for a vehicle
   */
  static async getFieldSourceSummary(vehicleId: string): Promise<FieldSourceSummary[]> {
    try {
      const { data, error } = await supabase.rpc('get_field_source_summary', {
        p_vehicle_id: vehicleId
      });

      if (error) {
        // If RPC not found or not deployed yet, return empty summary silently
        if ((error as any)?.code === 'PGRST202') return [];
        console.warn('Warning: get_field_source_summary unavailable. Returning empty. Details:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getFieldSourceSummary:', error);
      return [];
    }
  }

  /**
   * Get all field sources for a vehicle
   */
  static async getVehicleFieldSources(vehicleId: string): Promise<FieldSource[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_field_sources')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Error getting vehicle field sources:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getVehicleFieldSources:', error);
      return [];
    }
  }

  /**
   * Mark a field as human-verified
   */
  static async verifyField(
    vehicleId: string,
    fieldName: string,
    verifiedBy?: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicle_field_sources')
        .update({
          is_verified: true,
          verified_by: verifiedBy,
          verified_at: new Date().toISOString()
        })
        .eq('vehicle_id', vehicleId)
        .eq('field_name', fieldName);

      if (error) {
        console.error('Error verifying field:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in verifyField:', error);
      return false;
    }
  }

  /**
   * Helper to determine if a field change is human input vs automated
   */
  static determineSourceType(
    context: 'manual_input' | 'ai_scan' | 'ai_recognition' | 'bulk_import'
  ): DataSourceType {
    switch (context) {
      case 'manual_input':
        return 'human_input';
      case 'ai_scan':
        return 'ai_scan';
      case 'ai_recognition':
        return 'ai_recognition';
      case 'bulk_import':
        return 'bulk_import';
      default:
        return 'human_input';
    }
  }

  /**
   * Track form field changes with automatic source detection
   */
  static async trackFormFieldChange(
    vehicleId: string,
    fieldName: string,
    fieldValue: string,
    context: {
      isFromAI?: boolean;
      aiSource?: 'scan' | 'recognition' | 'suggestion';
      sourceUrl?: string;
      confidenceScore?: number;
      userId?: string;
    } = {}
  ): Promise<void> {
    let sourceType: DataSourceType;
    let sourceMetadata: Record<string, any> = {};

    if (context.isFromAI) {
      switch (context.aiSource) {
        case 'scan':
          sourceType = 'ai_scan';
          sourceMetadata = { source_url: context.sourceUrl };
          break;
        case 'recognition':
          sourceType = 'ai_recognition';
          break;
        case 'suggestion':
          sourceType = 'ai_suggestion';
          break;
        default:
          sourceType = 'ai_scan';
      }
    } else {
      sourceType = 'human_input';
      sourceMetadata = { input_method: 'manual_form_entry' };
    }

    await this.trackFieldSource(
      vehicleId,
      fieldName,
      fieldValue,
      sourceType,
      {
        confidenceScore: context.confidenceScore || 1.0,
        sourceMetadata,
        userId: context.userId
      }
    );
  }
}
