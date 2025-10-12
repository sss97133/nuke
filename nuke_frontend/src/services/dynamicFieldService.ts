import { supabase } from '../lib/supabase';

export interface DynamicField {
  id: string;
  vehicle_id: string;
  field_name: string;
  field_value: string;
  field_type: 'text' | 'number' | 'date' | 'boolean' | 'url';
  field_category: 'specs' | 'pricing' | 'history' | 'maintenance' | 'legal' | 'other';
  display_order: number;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface EvidenceDocument {
  id: string;
  vehicle_id: string;
  document_type: 'window_sticker' | 'service_record' | 'title' | 'registration' | 'manual' | 'other';
  image_id?: string;
  extracted_text?: string;
  confidence_score: number;
  processing_method: 'ocr' | 'manual_transcription';
  created_at: string;
}

export interface FieldAuditTrail {
  source_type: string;
  source_url?: string;
  source_image_url?: string;
  extraction_method?: string;
  raw_text?: string;
  ai_reasoning?: string;
  confidence: number;
  created_at: string;
  verification_status: boolean;
}

export class DynamicFieldService {
  /**
   * Add a new dynamic field with full audit trail
   */
  static async addDynamicField(
    vehicleId: string,
    fieldName: string,
    fieldValue: string,
    options: {
      fieldType?: DynamicField['field_type'];
      fieldCategory?: DynamicField['field_category'];
      sourceType?: string;
      sourceUrl?: string;
      sourceImageId?: string;
      extractionMethod?: string;
      rawText?: string;
      aiReasoning?: string;
      confidence?: number;
      userId?: string;
    } = {}
  ): Promise<string> {
    const {
      fieldType = 'text',
      fieldCategory = 'other',
      sourceType = 'ai_extraction',
      sourceUrl,
      sourceImageId,
      extractionMethod,
      rawText,
      aiReasoning,
      confidence = 0.8,
      userId
    } = options;

    const { data, error } = await supabase.rpc('add_dynamic_vehicle_field', {
      p_vehicle_id: vehicleId,
      p_field_name: fieldName,
      p_field_value: fieldValue,
      p_field_type: fieldType,
      p_field_category: fieldCategory,
      p_source_type: sourceType,
      p_source_url: sourceUrl,
      p_source_image_id: sourceImageId,
      p_extraction_method: extractionMethod,
      p_raw_text: rawText,
      p_ai_reasoning: aiReasoning,
      p_confidence: confidence,
      p_user_id: userId
    });

    if (error) {
      console.error('Error adding dynamic field:', error);
      throw error;
    }

    return data;
  }

  /**
   * Get all dynamic fields for a vehicle
   */
  static async getDynamicFields(vehicleId: string): Promise<DynamicField[]> {
    const { data, error } = await supabase
      .from('vehicle_dynamic_data')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('field_category', { ascending: true })
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching dynamic fields:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Get full audit trail for a specific field
   */
  static async getFieldAuditTrail(vehicleId: string, fieldName: string): Promise<FieldAuditTrail[]> {
    const { data, error } = await supabase.rpc('get_field_audit_trail', {
      p_vehicle_id: vehicleId,
      p_field_name: fieldName
    });

    if (error) {
      console.error('Error fetching field audit trail:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Process uploaded image for data extraction
   */
  static async processImageForData(
    vehicleId: string,
    imageId: string,
    documentType: EvidenceDocument['document_type'],
    userId: string
  ): Promise<{ extractedFields: DynamicField[]; evidenceId: string }> {
    // This would integrate with OCR service (Google Vision, AWS Textract, etc.)
    // For now, return placeholder structure
    
    try {
      // 1. Create evidence document record
      const { data: evidenceData, error: evidenceError } = await supabase
        .from('evidence_documents')
        .insert({
          vehicle_id: vehicleId,
          document_type: documentType,
          image_id: imageId,
          processing_method: 'ocr',
          confidence_score: 0.85
        })
        .select()
        .single();

      if (evidenceError) throw evidenceError;

      // 2. TODO: Implement actual OCR processing here
      // const ocrResults = await processImageWithOCR(imageUrl);
      
      // 3. TODO: Parse OCR results and extract structured data
      // const extractedData = await parseVehicleDocument(ocrResults, documentType);

      // 4. TODO: Add extracted fields as dynamic fields
      const extractedFields: DynamicField[] = [];
      
      // Example of what this would look like:
      // for (const field of extractedData) {
      //   await this.addDynamicField(vehicleId, field.name, field.value, {
      //     fieldType: field.type,
      //     fieldCategory: field.category,
      //     sourceType: 'ai_extraction',
      //     sourceImageId: imageId,
      //     extractionMethod: 'ocr',
      //     rawText: field.rawText,
      //     aiReasoning: field.reasoning,
      //     confidence: field.confidence,
      //     userId
      //   });
      // }

      return {
        extractedFields,
        evidenceId: evidenceData.id
      };
    } catch (error) {
      console.error('Error processing image for data extraction:', error);
      throw error;
    }
  }

  /**
   * Verify a dynamic field (mark as human-verified)
   */
  static async verifyField(vehicleId: string, fieldName: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('vehicle_dynamic_data')
      .update({ is_verified: true })
      .eq('vehicle_id', vehicleId)
      .eq('field_name', fieldName);

    if (error) {
      console.error('Error verifying field:', error);
      throw error;
    }

    // Also mark the most recent field source as verified
    await supabase
      .from('vehicle_field_sources')
      .update({ is_verified: true })
      .eq('vehicle_id', vehicleId)
      .eq('field_name', fieldName)
      .order('created_at', { ascending: false })
      .limit(1);
  }

  /**
   * Get evidence documents for a vehicle
   */
  static async getEvidenceDocuments(vehicleId: string): Promise<EvidenceDocument[]> {
    const { data, error } = await supabase
      .from('evidence_documents')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching evidence documents:', error);
      throw error;
    }

    return data || [];
  }
}
