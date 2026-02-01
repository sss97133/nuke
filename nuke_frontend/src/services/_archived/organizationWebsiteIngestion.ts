/**
 * Organization Website Ingestion Service
 * Handles ingesting vehicles from organization websites with duplicate prevention
 */

import { supabase } from '../lib/supabase';

export interface WebsiteIngestionResult {
  success: boolean;
  vehicles_processed: number;
  vehicles_skipped: number;
  vehicles_created: number;
  vehicles_merged: number;
  errors: string[];
}

/**
 * Check if a vehicle URL has already been ingested
 */
export async function isVehicleUrlAlreadyIngested(
  organizationId: string,
  vehicleUrl: string
): Promise<boolean> {
  const { data: mapping } = await supabase
    .from('organization_website_mappings')
    .select('known_vehicle_urls')
    .eq('organization_id', organizationId)
    .single();

  if (!mapping || !mapping.known_vehicle_urls) {
    return false;
  }

  return mapping.known_vehicle_urls.includes(vehicleUrl);
}

/**
 * Mark a vehicle URL as ingested
 */
export async function markVehicleUrlAsIngested(
  organizationId: string,
  vehicleUrl: string
): Promise<void> {
  // Get current mapping
  const { data: mapping } = await supabase
    .from('organization_website_mappings')
    .select('known_vehicle_urls')
    .eq('organization_id', organizationId)
    .single();

  const knownUrls = mapping?.known_vehicle_urls || [];
  
  // Add URL if not already present
  if (!knownUrls.includes(vehicleUrl)) {
    const updatedUrls = [...knownUrls, vehicleUrl];
    
    await supabase
      .from('organization_website_mappings')
      .update({ 
        known_vehicle_urls: updatedUrls,
        last_crawled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId);
  }
}

/**
 * Create or update website mapping for an organization
 */
export async function createOrUpdateWebsiteMapping(
  organizationId: string,
  websiteUrl: string,
  options?: {
    inventoryPagePattern?: string;
    vehicleDetailPattern?: string;
    servicesPageUrl?: string;
    aboutPageUrl?: string;
  }
): Promise<void> {
  const baseDomain = new URL(websiteUrl).hostname;

  // Check if mapping exists
  const { data: existing } = await supabase
    .from('organization_website_mappings')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('base_domain', baseDomain)
    .single();

  if (existing) {
    // Update existing
    await supabase
      .from('organization_website_mappings')
      .update({
        website_url: websiteUrl,
        inventory_page_pattern: options?.inventoryPagePattern,
        vehicle_detail_pattern: options?.vehicleDetailPattern,
        services_page_url: options?.servicesPageUrl,
        about_page_url: options?.aboutPageUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    // Create new
    await supabase
      .from('organization_website_mappings')
      .insert({
        organization_id: organizationId,
        website_url: websiteUrl,
        base_domain: baseDomain,
        inventory_page_pattern: options?.inventoryPagePattern,
        vehicle_detail_pattern: options?.vehicleDetailPattern,
        services_page_url: options?.servicesPageUrl,
        about_page_url: options?.aboutPageUrl,
        crawl_status: 'pending',
      });
  }
}

/**
 * Generate checksum for ingestion data to detect changes
 */
export async function generateIngestionChecksum(vehicleData: any[]): Promise<string> {
  const dataString = JSON.stringify(
    vehicleData.map(v => ({
      url: v.url,
      vin: v.vin,
      title: v.title,
      price: v.price,
    })).sort((a, b) => a.url.localeCompare(b.url))
  );
  
  // Use Web Crypto API for browser compatibility
  const encoder = new TextEncoder();
  const data = encoder.encode(dataString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if ingestion data has changed since last crawl
 */
export async function hasIngestionDataChanged(
  organizationId: string,
  vehicleData: any[]
): Promise<boolean> {
  const { data: mapping } = await supabase
    .from('organization_website_mappings')
    .select('ingestion_checksum')
    .eq('organization_id', organizationId)
    .single();

  if (!mapping || !mapping.ingestion_checksum) {
    return true; // No previous checksum, consider it changed
  }

  const currentChecksum = await generateIngestionChecksum(vehicleData);
  return currentChecksum !== mapping.ingestion_checksum;
}

/**
 * Update ingestion checksum after successful crawl
 */
export async function updateIngestionChecksum(
  organizationId: string,
  vehicleData: any[]
): Promise<void> {
  const checksum = await generateIngestionChecksum(vehicleData);
  
  await supabase
    .from('organization_website_mappings')
    .update({
      ingestion_checksum: checksum,
      last_crawled_at: new Date().toISOString(),
      crawl_status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', organizationId);
}

/**
 * Ingest vehicles from organization website with duplicate prevention
 */
export async function ingestVehiclesFromWebsite(
  organizationId: string,
  vehicleData: Array<{
    url: string;
    vin?: string;
    year?: number;
    make?: string;
    model?: string;
    price?: number;
    title?: string;
    images?: string[];
  }>
): Promise<WebsiteIngestionResult> {
  const result: WebsiteIngestionResult = {
    success: true,
    vehicles_processed: 0,
    vehicles_skipped: 0,
    vehicles_created: 0,
    vehicles_merged: 0,
    errors: [],
  };

  for (const vehicle of vehicleData) {
    result.vehicles_processed++;

    try {
      // Check if URL already ingested
      const alreadyIngested = await isVehicleUrlAsIngested(organizationId, vehicle.url);
      if (alreadyIngested) {
        result.vehicles_skipped++;
        continue;
      }

      // Check for existing vehicle by VIN (if available)
      let existingVehicleId: string | null = null;
      if (vehicle.vin) {
        const { data: existing } = await supabase
          .from('vehicles')
          .select('id')
          .eq('vin', vehicle.vin)
          .single();

        if (existing) {
          existingVehicleId = existing.id;
        }
      }

      // Create or link vehicle
      if (existingVehicleId) {
        // Link to organization
        await supabase
          .from('organization_vehicles')
          .upsert({
            organization_id: organizationId,
            vehicle_id: existingVehicleId,
            relationship_type: 'in_stock',
            status: 'active',
            auto_tagged: false,
            linked_by_user_id: null, // System ingestion
          }, {
            onConflict: 'organization_id,vehicle_id,relationship_type',
          });

        result.vehicles_merged++;
      } else {
        // Create new vehicle
        const { data: newVehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .insert({
            vin: vehicle.vin || null,
            year: vehicle.year || null,
            make: vehicle.make || null,
            model: vehicle.model || null,
          })
          .select()
          .single();

        if (vehicleError) {
          result.errors.push(`Failed to create vehicle: ${vehicleError.message}`);
          continue;
        }

        // Link to organization
        await supabase
          .from('organization_vehicles')
          .insert({
            organization_id: organizationId,
            vehicle_id: newVehicle.id,
            relationship_type: 'in_stock',
            status: 'active',
            auto_tagged: false,
          });

        result.vehicles_created++;
      }

      // Mark URL as ingested
      await markVehicleUrlAsIngested(organizationId, vehicle.url);

    } catch (error: any) {
      result.errors.push(`Error processing ${vehicle.url}: ${error.message}`);
      result.success = false;
    }
  }

  // Update checksum after successful ingestion
  if (result.success && result.errors.length === 0) {
    await updateIngestionChecksum(organizationId, vehicleData);
  }

  return result;
}

// Fix typo in function name
const isVehicleUrlAsIngested = isVehicleUrlAlreadyIngested;

