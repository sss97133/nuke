/**
 * CaptureIntegrationService
 * 
 * This service processes vehicle captures from external sources (like the Chrome extension)
 * and integrates them into the main vehicle database while maintaining digital identity integrity.
 * 
 * Key features:
 * - Processing individual vehicle captures from the Chrome extension
 * - Bulk processing of pending captures
 * - Creating and updating vehicle records with capture data
 * - Generating appropriate timeline events for captured vehicles
 * - Validating and sanitizing capture data
 * - Handling errors and providing detailed processing results
 */

import { supabase } from "@/integrations/supabase/client";
import { handleDatabaseError } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/utils";

export interface VehicleCapture {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  color?: string;
  trim?: string;
  price?: number;
  image_url?: string;
  capture_url: string;
  source: string;
  user_id?: string;
  created_at: string;
  metadata?: Record<string, any>;
  processed?: boolean;
  processed_at?: string;
  vehicle_id?: string;
}

export interface ProcessResult {
  success: boolean;
  vehicleId?: string;
  message: string;
  error?: any;
  captureId?: string;
  vin?: string;
  source?: string;
}

export class CaptureIntegrationService {
  /**
   * Validates a VIN to ensure it's properly formatted
   */
  private static validateVin(vin: string): boolean {
    // Basic VIN validation - 17 alphanumeric characters, excluding I, O, Q
    if (!vin || typeof vin !== 'string') return false;
    if (vin.length !== 17) return false;
    
    // Check for invalid characters (I, O, Q)
    if (/[IOQ]/.test(vin)) return false;
    
    // Allow only alphanumeric characters
    if (!/^[A-HJ-NPR-Z0-9]+$/.test(vin)) return false;
    
    return true;
  }

  /**
   * Sanitizes capture data to ensure it meets database requirements
   */
  private static sanitizeCaptureData(capture: VehicleCapture): VehicleCapture {
    return {
      ...capture,
      // Ensure text fields are strings and have reasonable lengths
      make: (capture.make || '').slice(0, 50),
      model: (capture.model || '').slice(0, 100),
      vin: (capture.vin || '').toUpperCase().slice(0, 17),
      color: capture.color ? capture.color.slice(0, 50) : undefined,
      trim: capture.trim ? capture.trim.slice(0, 50) : undefined,
      // Ensure year is a reasonable number
      year: typeof capture.year === 'number' && capture.year > 1900 && capture.year <= new Date().getFullYear() + 1
        ? capture.year
        : new Date().getFullYear()
    };
  }

  /**
   * Process a single vehicle capture and add it to the main vehicles database
   */
  public static async processCapture(captureId: string): Promise<ProcessResult> {
    try {
      // Check if Supabase client is initialized
      if (!supabase) {
        return {
          success: false,
          message: "Database client not initialized",
        };
      }

      // Fetch the capture from captured_vehicles table
      const { data: capture, error: captureError } = await supabase
        .from("captured_vehicles")
        .select("*")
        .eq("id", captureId)
        .single();

      if (captureError) {
        console.error("Error fetching capture:", captureError);
        return {
          success: false,
          message: `Error fetching capture: ${handleDatabaseError(captureError)}`,
          error: captureError,
        };
      }

      if (!capture) {
        return {
          success: false,
          message: "Capture not found",
        };
      }

      // Check if a vehicle with this VIN already exists
      const { data: existingVehicle, error: vehicleError } = await supabase
        .from("vehicles")
        .select("id, capture_count, updated_at")
        .eq("vin", capture.vin)
        .maybeSingle();

      if (vehicleError) {
        console.error("Error checking existing vehicle:", vehicleError);
        return {
          success: false,
          message: `Error checking existing vehicle: ${handleDatabaseError(vehicleError)}`,
          error: vehicleError,
        };
      }

      // If vehicle exists, update its capture-related fields
      if (existingVehicle) {
        const { error: updateError } = await supabase
          .from("vehicles")
          .update({
            updated_at: new Date().toISOString(),
            capture_count: (existingVehicle.capture_count || 0) + 1,
            last_capture_date: capture.created_at,
            last_capture_source: capture.source,
          })
          .eq("id", existingVehicle.id);

        if (updateError) {
          console.error("Error updating existing vehicle:", updateError);
          return {
            success: false,
            message: `Error updating existing vehicle: ${handleDatabaseError(updateError)}`,
            error: updateError,
          };
        }

        // Add a timeline event for the capture
        await this.addCaptureTimelineEvent(existingVehicle.id, capture);

        // Update the capture record to mark it as processed
        await supabase
          .from("captured_vehicles")
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
            vehicle_id: existingVehicle.id,
          })
          .eq("id", captureId);

        return {
          success: true,
          vehicleId: existingVehicle.id,
          message: `Updated existing vehicle with new capture data`,
        };
      }

      // If vehicle doesn't exist, create a new one
      const { data: newVehicle, error: insertError } = await supabase
        .from("vehicles")
        .insert({
          make: capture.make,
          model: capture.model,
          year: capture.year,
          vin: capture.vin,
          color: capture.color,
          trim: capture.trim,
          image_url: capture.image_url,
          user_id: capture.user_id || "00000000-0000-0000-0000-000000000000", // Use anonymous user if none provided
          capture_count: 1,
          last_capture_date: capture.created_at,
          last_capture_source: capture.source,
          original_capture_id: captureId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "unverified",
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error creating new vehicle:", insertError);
        return {
          success: false,
          message: `Error creating new vehicle: ${handleDatabaseError(insertError)}`,
          error: insertError,
        };
      }

      // Add initial timeline event for the capture
      await this.addCaptureTimelineEvent(newVehicle.id, capture);

      // Update the capture record to mark it as processed
      await supabase
        .from("captured_vehicles")
        .update({
          processed: true,
          processed_at: new Date().toISOString(),
          vehicle_id: newVehicle.id,
        })
        .eq("id", captureId);

      return {
        success: true,
        vehicleId: newVehicle.id,
        message: `Created new vehicle from capture data`,
      };
    } catch (error) {
      console.error("Unexpected error processing capture:", error);
      return {
        success: false,
        message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        error,
      };
    }
  }

  /**
   * Process a batch of captures based on their IDs
   */
  public static async processCapturesBatch(captureIds: string[]): Promise<{
    processed: number;
    failed: number;
    results: ProcessResult[];
  }> {
    try {
      if (!supabase) {
        return {
          processed: 0,
          failed: captureIds.length,
          results: [
            {
              success: false,
              message: "Database client not initialized",
            },
          ],
        };
      }

      // Process each capture
      const results: ProcessResult[] = [];
      let processed = 0;
      let failed = 0;

      for (const captureId of captureIds) {
        const result = await this.processCapture(captureId);
        results.push(result);

        if (result.success) {
          processed++;
        } else {
          failed++;
        }
      }

      return {
        processed,
        failed,
        results,
      };
    } catch (error) {
      console.error("Unexpected error processing batch captures:", error);
      return {
        processed: 0,
        failed: captureIds.length,
        results: [
          {
            success: false,
            message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
            error,
          },
        ],
      };
    }
  }

  /**
   * Process all unprocessed captures from the database
   */
  public static async processAllPendingCaptures(): Promise<{
    processed: number;
    failed: number;
    results: ProcessResult[];
  }> {
    try {
      if (!supabase) {
        return {
          processed: 0,
          failed: 1,
          results: [
            {
              success: false,
              message: "Database client not initialized",
            },
          ],
        };
      }

      // Find all unprocessed captures
      const { data: pendingCaptures, error: fetchError } = await supabase
        .from("captured_vehicles")
        .select("id")
        .eq("processed", false)
        .order("created_at", { ascending: true });

      if (fetchError) {
        console.error("Error fetching pending captures:", fetchError);
        return {
          processed: 0,
          failed: 1,
          results: [
            {
              success: false,
              message: `Error fetching pending captures: ${handleDatabaseError(fetchError)}`,
              error: fetchError,
            },
          ],
        };
      }

      if (!pendingCaptures || pendingCaptures.length === 0) {
        return {
          processed: 0,
          failed: 0,
          results: [],
        };
      }

      // Process each capture
      const results: ProcessResult[] = [];
      let processed = 0;
      let failed = 0;

      for (const capture of pendingCaptures) {
        const result = await this.processCapture(capture.id);
        results.push(result);

        if (result.success) {
          processed++;
        } else {
          failed++;
        }
      }

      return {
        processed,
        failed,
        results,
      };
    } catch (error) {
      console.error("Unexpected error processing pending captures:", error);
      return {
        processed: 0,
        failed: 1,
        results: [
          {
            success: false,
            message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
            error,
          },
        ],
      };
    }
  }

  /**
   * Add a timeline event for a vehicle capture
   */
  private static async addCaptureTimelineEvent(
    vehicleId: string,
    capture: VehicleCapture
  ): Promise<void> {
    try {
      if (!supabase) return;

      // Calculate a confidence score based on data quality
      let confidenceScore = 85; // Base score
      
      // Adjust score based on data completeness
      if (!capture.vin || capture.vin.length !== 17) confidenceScore -= 15;
      if (!capture.image_url) confidenceScore -= 5;
      if (!capture.price) confidenceScore -= 3;
      if (!capture.trim) confidenceScore -= 2;
      if (!capture.color) confidenceScore -= 2;
      
      // Additional metadata for enhanced timeline displays
      const eventMetadata = {
        capture_id: capture.id,
        capture_url: capture.capture_url,
        price: capture.price,
        color: capture.color,
        source_system: 'chrome_extension',
        ...capture.metadata,
      };

      // Create a more descriptive title based on the source
      let title = 'Vehicle Spotted';
      let description = `${capture.year} ${capture.make} ${capture.model}`;
      
      if (capture.source) {
        if (capture.source.includes('dealer')) {
          title = 'Listed at Dealership';
          description += ' offered for sale at a dealership';
        } else if (capture.source.includes('auction')) {
          title = 'Available at Auction';
          description += ' available at auction';
        } else if (capture.source.includes('private')) {
          title = 'Private Sale Listing';
          description += ' listed for private sale';
        } else {
          title = `Vehicle Spotted on ${capture.source}`;
          description += ` spotted at ${formatDate(capture.created_at)}`;
        }
      }
      
      // Add price information if available
      if (capture.price) {
        description += ` at $${capture.price.toLocaleString()}`;
      }

      await supabase.from("vehicle_timeline_events").insert({
        vehicle_id: vehicleId,
        event_type: "capture",
        source: capture.source || "chrome_extension",
        event_date: capture.created_at,
        title,
        description,
        confidence_score: confidenceScore,
        metadata: eventMetadata,
        source_url: capture.capture_url,
        image_urls: capture.image_url ? [capture.image_url] : [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error adding capture timeline event:", error);
      // Non-critical error, so we don't throw
    }
  }
  
  /**
   * Import captures from a Chrome extension upload
   * This method handles bulk data imports directly from the extension
   */
  public static async importCapturesFromExtension(
    captures: Partial<VehicleCapture>[]
  ): Promise<{
    imported: number;
    failed: number;
    results: ProcessResult[];
  }> {
    try {
      if (!supabase) {
        return {
          imported: 0,
          failed: captures.length,
          results: [{
            success: false,
            message: "Database client not initialized"
          }]
        };
      }
      
      const results: ProcessResult[] = [];
      let imported = 0;
      let failed = 0;
      
      // Process each capture
      for (const capture of captures) {
        try {
          // Validate required fields
          if (!capture.make || !capture.model || !capture.year || !capture.vin) {
            failed++;
            results.push({
              success: false,
              message: "Missing required fields (make, model, year, or VIN)",
              captureId: capture.id,
              vin: capture.vin,
            });
            continue;
          }
          
          // Validate VIN
          if (!this.validateVin(capture.vin!)) {
            failed++;
            results.push({
              success: false,
              message: `Invalid VIN format: ${capture.vin}`,
              vin: capture.vin,
            });
            continue;
          }
          
          // Prepare capture for insertion
          const nowIso = new Date().toISOString();
          const newCapture = {
            id: capture.id || crypto.randomUUID(),
            make: capture.make,
            model: capture.model,
            year: capture.year,
            vin: capture.vin.toUpperCase(),
            color: capture.color,
            trim: capture.trim,
            price: capture.price,
            image_url: capture.image_url,
            capture_url: capture.capture_url || '',
            source: capture.source || 'chrome_extension',
            user_id: capture.user_id,
            created_at: capture.created_at || nowIso,
            metadata: capture.metadata || {},
            processed: false
          };
          
          // Insert into captured_vehicles table
          const { data, error } = await supabase
            .from('captured_vehicles')
            .insert(newCapture)
            .select('id')
            .single();
          
          if (error) {
            failed++;
            results.push({
              success: false,
              message: `Failed to import capture: ${handleDatabaseError(error)}`,
              error,
              vin: capture.vin,
              source: capture.source
            });
          } else {
            imported++;
            results.push({
              success: true,
              message: 'Capture imported successfully',
              captureId: data.id,
              vin: capture.vin,
              source: capture.source
            });
          }
        } catch (captureError) {
          failed++;
          results.push({
            success: false,
            message: `Error processing capture: ${captureError instanceof Error ? captureError.message : String(captureError)}`,
            error: captureError,
            vin: capture.vin
          });
        }
      }
      
      return {
        imported,
        failed,
        results
      };
    } catch (error) {
      console.error("Unexpected error importing captures:", error);
      return {
        imported: 0,
        failed: captures.length,
        results: [{
          success: false,
          message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          error
        }]
      };
    }
  }
}
