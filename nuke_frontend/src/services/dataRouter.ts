/**
 * Data Router Service
 * 
 * Routes extracted data to correct database tables with proper vehicle matching.
 * Follows VIN-first, then year/make/model matching pattern.
 */

import { supabase } from '../lib/supabase';
import type { ExtractedVehicleData, ExtractedReceiptData } from './aiDataIngestion';
import { organizationFromSource } from './organizationFromSource';
import { VehicleDataExtractionService } from './vehicleDataExtractionService';
import vinDecoderService from './vinDecoder';

export interface VehicleMatchResult {
  vehicleId: string;
  isNew: boolean;
  matchType: 'vin' | 'year_make_model' | 'created';
  confidence: number;
}

export interface DatabaseOperationPlan {
  vehicleOperation: {
    vehicleId: string;
    isNew: boolean;
    updates: Partial<ExtractedVehicleData>;
  };
  timelineEvent?: {
    eventType: string;
    title: string;
    description?: string;
    metadata?: any;
  };
  receiptOperation?: {
    receiptData: ExtractedReceiptData;
  };
  imageOperations?: Array<{
    imageUrl: string;
    isPrimary?: boolean;
  }>;
  organizationLink?: {
    source: string;
    listingUrl?: string;
    relationshipType?: 'owner' | 'seller' | 'inventory';
    additionalInfo?: {
      seller?: string;
      location?: string;
      phone?: string;
      email?: string;
    };
  };
}

class DataRouterService {
  private sanitizeVin(raw: any): string | null {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const res = vinDecoderService.validateVIN(s);
    if (!res.valid) return null;
    // Guard against garbage strings that happen to match the VIN regex.
    if (!/\d/.test(res.normalized)) return null;
    return res.normalized;
  }

  /**
   * Normalize vehicle data for automation (extract model/series/trim)
   * This is used for automated scraping to ensure proper categorization
   */
  normalizeVehicleDataForAutomation(
    vehicleData: ExtractedVehicleData,
    title?: string | null,
    description?: string | null
  ): ExtractedVehicleData {
    // Use extraction service to get proper model/series/trim
    const extracted = VehicleDataExtractionService.extractVehicleFields(
      vehicleData.make,
      vehicleData.model,
      title,
      description,
      vehicleData.year
    );

    // Return normalized data with series/trim properly separated
    return {
      ...vehicleData,
      make: extracted.make,
      model: extracted.model,
      series: extracted.series || vehicleData.series,
      trim: extracted.trim || vehicleData.trim
    };
  }

  /**
   * Find or create vehicle from extracted data
   * Follows: VIN-first, then year/make/model, then create
   * For automation, set normalizeForAutomation=true to extract model/series/trim
   */
  async findOrCreateVehicle(
    vehicleData: ExtractedVehicleData,
    userId: string,
    options?: {
      normalizeForAutomation?: boolean;
      title?: string | null;
      description?: string | null;
    }
  ): Promise<VehicleMatchResult> {
    // Normalize for automation if requested
    let normalizedData = vehicleData;
    if (options?.normalizeForAutomation) {
      normalizedData = this.normalizeVehicleDataForAutomation(
        vehicleData,
        options.title,
        options.description
      );
    }

    // Never route garbage VINs into the canonical vehicles table.
    (normalizedData as any).vin = this.sanitizeVin((normalizedData as any).vin);
    // Primary: Try to find by VIN
    if (normalizedData.vin) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', normalizedData.vin)
        .maybeSingle();

      if (existing) {
        return {
          vehicleId: existing.id,
          isNew: false,
          matchType: 'vin',
          confidence: 1.0
        };
      }
    }

    // Secondary: Try to find by year/make/model (and series if available)
    if (normalizedData.year && normalizedData.make && normalizedData.model) {
      let query = supabase
        .from('vehicles')
        .select('id, vin')
        .eq('year', normalizedData.year)
        .ilike('make', normalizedData.make)
        .ilike('model', normalizedData.model);

      // If we have series, include it in matching for better accuracy
      if (normalizedData.series) {
        query = query.ilike('series', normalizedData.series);
      }

      const { data: existing } = await query.maybeSingle();

      if (existing) {
        // Update VIN if we have one and existing doesn't
        if (normalizedData.vin && !existing.vin) {
          await supabase
            .from('vehicles')
            .update({ vin: normalizedData.vin })
            .eq('id', existing.id);
        }

        return {
          vehicleId: existing.id,
          isNew: false,
          matchType: 'year_make_model',
          confidence: 0.85
        };
      }
    }

    // Validate required fields before creating vehicle
    if (!normalizedData.make || !normalizedData.model || !normalizedData.year) {
      throw new Error(
        `Cannot create vehicle: missing required fields. ` +
        `Required: make, model, year. ` +
        `Received: make=${normalizedData.make || 'null'}, ` +
        `model=${normalizedData.model || 'null'}, ` +
        `year=${normalizedData.year || 'null'}`
      );
    }

    // Create new vehicle with normalized data
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert({
        vin: normalizedData.vin || null,
        year: normalizedData.year,
        make: normalizedData.make,
        model: normalizedData.model,
        series: normalizedData.series || null,
        trim: normalizedData.trim || null,
        mileage: normalizedData.mileage || null,
        color: normalizedData.color || null,
        transmission: normalizedData.transmission || null,
        drivetrain: normalizedData.drivetrain || null,
        engine_size: normalizedData.engine_size || normalizedData.engine || null,
        body_style: normalizedData.body_type || null,
        is_public: true
      })
      .select('id')
      .single();

    if (error) throw error;

    return {
      vehicleId: newVehicle!.id,
      isNew: true,
      matchType: 'created',
      confidence: 0.7
    };
  }

  /**
   * Generate database operation plan from extracted data
   */
  async generateOperationPlan(
    vehicleData: ExtractedVehicleData,
    receiptData?: ExtractedReceiptData,
    userId?: string,
    sourceInfo?: {
      source: string;
      listingUrl?: string;
      seller?: string;
      location?: string;
      phone?: string;
      email?: string;
    }
  ): Promise<DatabaseOperationPlan> {
    if (!userId) {
      const { data: userData } = await supabase.auth.getUser();
      userId = userData.user?.id || undefined;
    }

    if (!userId) {
      throw new Error('User ID required for database operations');
    }

    // Find or create vehicle
    const vehicleMatch = await this.findOrCreateVehicle(vehicleData, userId);

    // Build updates object (only non-null values, matching database schema)
    const updates: any = {};
    if (vehicleData.mileage !== undefined) updates.mileage = vehicleData.mileage;
    if (vehicleData.price !== undefined) updates.asking_price = vehicleData.price;
    if (vehicleData.color) updates.color = vehicleData.color;
    if (vehicleData.transmission) updates.transmission = vehicleData.transmission;
    if (vehicleData.drivetrain) updates.drivetrain = vehicleData.drivetrain;
    if (vehicleData.engine_size || vehicleData.engine) {
      updates.engine_size = vehicleData.engine_size || vehicleData.engine;
    }
    if (vehicleData.trim) updates.trim = vehicleData.trim;
    if (vehicleData.body_type) updates.body_style = vehicleData.body_type;

    const plan: DatabaseOperationPlan = {
      vehicleOperation: {
        vehicleId: vehicleMatch.vehicleId,
        isNew: vehicleMatch.isNew,
        updates
      },
      timelineEvent: {
        eventType: vehicleMatch.isNew ? 'other' : 'other',
        title: vehicleMatch.isNew 
          ? `Vehicle profile created from ${vehicleData.vin ? 'VIN' : 'data extraction'}`
          : `Vehicle data updated from ${vehicleData.vin ? 'VIN' : 'data extraction'}`,
        description: vehicleData.description || undefined,
        metadata: {
          source: 'ai_data_ingestion',
          matchType: vehicleMatch.matchType,
          confidence: vehicleMatch.confidence,
          extractedFields: Object.keys(updates)
        }
      }
    };

    // Add receipt operation if present
    if (receiptData) {
      plan.receiptOperation = {
        receiptData
      };
    }

    // Add image operations if present
    if (vehicleData.images && vehicleData.images.length > 0) {
      plan.imageOperations = vehicleData.images.map((url, index) => ({
        imageUrl: url,
        isPrimary: index === 0
      }));
    }

    // Add organization link if source looks like an organization
    if (sourceInfo?.source) {
      const orgMap = organizationFromSource.getOrganizationMap(sourceInfo.source);
      if (orgMap) {
        plan.organizationLink = {
          source: sourceInfo.source,
          listingUrl: sourceInfo.listingUrl,
          relationshipType: 'inventory', // Default for listings
          additionalInfo: {
            seller: sourceInfo.seller,
            location: sourceInfo.location,
            phone: sourceInfo.phone,
            email: sourceInfo.email
          }
        };
      }
    }

    return plan;
  }

  /**
   * Execute database operations from plan
   */
  async executeOperationPlan(
    plan: DatabaseOperationPlan,
    userId: string
  ): Promise<{
    vehicleId: string;
    timelineEventId?: string;
    receiptId?: string;
    imageIds?: string[];
    organizationId?: string;
  }> {
    const results: any = {
      vehicleId: plan.vehicleOperation.vehicleId
    };

    // Update vehicle if needed
    if (!plan.vehicleOperation.isNew && Object.keys(plan.vehicleOperation.updates).length > 0) {
      const { error } = await supabase
        .from('vehicles')
        .update(plan.vehicleOperation.updates)
        .eq('id', plan.vehicleOperation.vehicleId);

      if (error) throw error;
    }

    // Create timeline event
    if (plan.timelineEvent) {
      const { data: timelineEvent, error } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: plan.vehicleOperation.vehicleId,
          user_id: userId,
          event_type: plan.timelineEvent.eventType,
          source: 'ai_data_ingestion',
          title: plan.timelineEvent.title,
          description: plan.timelineEvent.description || null,
          event_date: new Date().toISOString().split('T')[0],
          metadata: plan.timelineEvent.metadata || {}
        })
        .select('id')
        .single();

      if (error) throw error;
      results.timelineEventId = timelineEvent.id;
    }

    // Create receipt if present
    if (plan.receiptOperation) {
      const receipt = plan.receiptOperation.receiptData;
      const { data: receiptRecord, error } = await supabase
        .from('receipts')
        .insert({
          vehicle_id: plan.vehicleOperation.vehicleId,
          user_id: userId,
          vendor: receipt.vendor || null,
          purchase_date: receipt.date ? new Date(receipt.date).toISOString().split('T')[0] : null,
          total_amount: receipt.total || null,
          items: receipt.items || [],
          metadata: {
            source: 'ai_data_ingestion',
            extracted_vin: receipt.vehicle_vin || null
          }
        })
        .select('id')
        .single();

      if (error) throw error;
      results.receiptId = receiptRecord.id;
    }

    // Upload and link images if present
    if (plan.imageOperations && plan.imageOperations.length > 0) {
      const imageIds: string[] = [];
      
      for (const imgOp of plan.imageOperations) {
        // Note: Images should already be uploaded to storage
        // This just creates the database record
        const { data: imageRecord, error } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: plan.vehicleOperation.vehicleId,
            image_url: imgOp.imageUrl,
            is_primary: imgOp.isPrimary || false,
            user_id: userId,
            source: 'ai_data_ingestion'
          })
          .select('id')
          .single();

        if (!error && imageRecord) {
          imageIds.push(imageRecord.id);
        }
      }

      results.imageIds = imageIds;
    }

    // Link to organization if source is an organization
    if (plan.organizationLink) {
      try {
        const organizationId = await organizationFromSource.linkVehicleToSourceOrganization(
          plan.vehicleOperation.vehicleId,
          plan.organizationLink.source,
          plan.organizationLink.listingUrl,
          plan.organizationLink.relationshipType || 'inventory',
          plan.organizationLink.additionalInfo
        );
        
        if (organizationId) {
          results.organizationId = organizationId;
        }
      } catch (error) {
        console.error('Error linking vehicle to organization:', error);
        // Don't fail the whole operation if org linking fails
      }
    }

    return results;
  }
}

export const dataRouter = new DataRouterService();

