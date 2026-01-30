/**
 * Database Client for Craigslist Archive Import
 * Handles all Supabase operations for the import process
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CraigslistListing } from './html-parser';
import type { ExtractedPhone } from './phone-extractor';

export interface ImportBatch {
  id: string;
  import_name: string;
  historian_user_id: string | null;
  source_directory: string;
  file_count: number;
  files_processed: number;
  files_failed: number;
  vehicles_created: number;
  vehicles_updated: number;
  contacts_created: number;
  timeline_events_created: number;
  status: string;
  error_log: any[];
  started_at: string;
  created_at: string;
}

export interface ImportResult {
  success: boolean;
  vehicleId?: string;
  contactId?: string;
  timelineEventId?: string;
  error?: string;
}

let supabase: SupabaseClient | null = null;

/**
 * Initialize Supabase client
 */
export function initSupabase(): SupabaseClient {
  if (supabase) return supabase;

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }

  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabase;
}

/**
 * Get the current authenticated user (historian)
 */
export async function getHistorianUserId(): Promise<string | null> {
  // For service role key, we need to look up a known user
  // or use a specific historian user ID from environment
  const historianId = process.env.HISTORIAN_USER_ID;
  if (historianId) return historianId;

  // Try to get the first admin user as fallback
  const client = initSupabase();
  const { data } = await client
    .from('admin_users')
    .select('user_id')
    .eq('is_active', true)
    .limit(1)
    .single();

  return data?.user_id || null;
}

/**
 * Create or get an import batch
 */
export async function createImportBatch(
  name: string,
  sourceDirectory: string,
  fileCount: number,
  historianUserId: string | null
): Promise<ImportBatch> {
  const client = initSupabase();

  const { data, error } = await client
    .from('archive_imports')
    .insert({
      import_name: name,
      import_source: 'craigslist_archive',
      historian_user_id: historianUserId,
      source_directory: sourceDirectory,
      file_count: fileCount,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create import batch: ${error.message}`);
  }

  return data;
}

/**
 * Update import batch statistics
 */
export async function updateImportBatch(
  batchId: string,
  updates: Partial<ImportBatch>
): Promise<void> {
  const client = initSupabase();

  const { error } = await client
    .from('archive_imports')
    .update(updates)
    .eq('id', batchId);

  if (error) {
    console.error(`Failed to update import batch: ${error.message}`);
  }
}

/**
 * Add error to import batch log
 */
export async function logImportError(
  batchId: string,
  filePath: string,
  errorMessage: string
): Promise<void> {
  const client = initSupabase();

  // Get current error log
  const { data } = await client
    .from('archive_imports')
    .select('error_log')
    .eq('id', batchId)
    .single();

  const errorLog = data?.error_log || [];
  errorLog.push({
    file: filePath,
    error: errorMessage,
    timestamp: new Date().toISOString(),
  });

  await client
    .from('archive_imports')
    .update({ error_log: errorLog })
    .eq('id', batchId);
}

/**
 * Import a vehicle from a Craigslist listing
 */
export async function importVehicle(
  listing: CraigslistListing,
  historianUserId: string | null,
  filePath: string
): Promise<ImportResult> {
  const client = initSupabase();

  try {
    // Check for existing vehicle by post ID in origin_metadata
    const { data: existing } = await client
      .from('vehicles')
      .select('id')
      .contains('origin_metadata', { craigslist_post_id: listing.postId })
      .single();

    if (existing) {
      return {
        success: true,
        vehicleId: existing.id,
        error: 'Vehicle already exists',
      };
    }

    // Build vehicle record
    const vehicleData = {
      make: listing.make || 'Unknown',
      model: listing.model || listing.title,
      year: listing.year,
      vin: listing.vin,
      color: listing.paintColor,
      mileage: listing.odometer,
      fuel_type: listing.fuel,
      transmission: listing.transmission,
      drivetrain: listing.drive,
      body_style: listing.type,
      asking_price: listing.price,
      discovery_source: 'craigslist_archive',
      discovery_url: listing.originalUrl,
      notes: listing.description,
      is_public: true,
      status: 'archived',
      origin_metadata: {
        craigslist_post_id: listing.postId,
        listing_date: listing.postedDate?.toISOString(),
        listing_updated: listing.updatedDate?.toISOString(),
        location: listing.location,
        latitude: listing.latitude,
        longitude: listing.longitude,
        map_address: listing.mapAddress,
        attributes: listing.attributes,
        image_urls: listing.imageUrls,
        archive_file_path: filePath,
        historian_id: historianUserId,
        repost_of: listing.repostOf,
        condition: listing.condition,
        title_status: listing.titleStatus,
        cylinders: listing.cylinders,
        size: listing.size,
      },
    };

    // Insert vehicle
    const { data: vehicle, error: vehicleError } = await client
      .from('vehicles')
      .insert(vehicleData)
      .select('id')
      .single();

    if (vehicleError) {
      throw new Error(`Failed to insert vehicle: ${vehicleError.message}`);
    }

    // Add historian as contributor
    if (historianUserId) {
      await addHistorianContributor(vehicle.id, historianUserId, listing);
    }

    return {
      success: true,
      vehicleId: vehicle.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Add historian as vehicle contributor
 */
async function addHistorianContributor(
  vehicleId: string,
  historianUserId: string,
  listing: CraigslistListing
): Promise<void> {
  const client = initSupabase();

  const listingDate = listing.postedDate
    ? listing.postedDate.toISOString().split('T')[0]
    : 'unknown date';

  await client.from('vehicle_contributor_roles').upsert({
    vehicle_id: vehicleId,
    user_id: historianUserId,
    role: 'historian',
    notes: `Preserved CL listing from ${listingDate}. Post ID: ${listing.postId}`,
    is_active: true,
    start_date: new Date().toISOString().split('T')[0],
  }, {
    onConflict: 'vehicle_id,user_id,role',
  });
}

/**
 * Create or get an unverified contact
 */
export async function createOrGetContact(
  phone: ExtractedPhone,
  location: string | null
): Promise<string | null> {
  const client = initSupabase();

  // Check if contact already exists by hash
  const { data: existing } = await client
    .from('unverified_contacts')
    .select('id')
    .eq('phone_hash', phone.hash)
    .single();

  if (existing) {
    return existing.id;
  }

  // Create new contact
  const { data: contact, error } = await client
    .from('unverified_contacts')
    .insert({
      phone_number: phone.normalized,
      phone_raw: phone.raw,
      phone_hash: phone.hash,
      location: location,
      verification_status: 'unverified',
      outreach_status: 'pending',
      metadata: {
        confidence: phone.confidence,
        extracted_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error(`Failed to create contact: ${error.message}`);
    return null;
  }

  return contact.id;
}

/**
 * Link a vehicle to an unverified owner
 */
export async function linkVehicleToOwner(
  vehicleId: string,
  contactId: string,
  listing: CraigslistListing,
  historianUserId: string | null
): Promise<void> {
  const client = initSupabase();

  await client.from('vehicle_unverified_owners').upsert({
    vehicle_id: vehicleId,
    contact_id: contactId,
    source_listing_url: listing.originalUrl,
    source_post_id: listing.postId,
    listing_date: listing.postedDate?.toISOString().split('T')[0],
    asking_price: listing.price,
    relationship_type: 'seller',
    confidence_score: 0.5,
    created_by: historianUserId,
  }, {
    onConflict: 'vehicle_id,contact_id,source_post_id',
  });
}

/**
 * Create a discovery timeline event for the vehicle
 */
export async function createDiscoveryEvent(
  vehicleId: string,
  listing: CraigslistListing,
  historianUserId: string | null
): Promise<string | null> {
  const client = initSupabase();

  const eventDate = listing.postedDate || new Date();

  const { data, error } = await client
    .from('timeline_events')
    .insert({
      vehicle_id: vehicleId,
      user_id: historianUserId,
      event_type: 'listing',
      event_category: 'ownership',
      title: `Listed on Craigslist: ${listing.title}`,
      description: listing.description?.substring(0, 500),
      event_date: eventDate.toISOString().split('T')[0],
      mileage_at_event: listing.odometer,
      source: 'craigslist_archive',
      confidence_score: 60,
      metadata: {
        original_url: listing.originalUrl,
        post_id: listing.postId,
        asking_price: listing.price,
        location: listing.location,
        latitude: listing.latitude,
        longitude: listing.longitude,
        image_count: listing.imageUrls.length,
        source: 'craigslist_archive_import',
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error(`Failed to create timeline event: ${error.message}`);
    return null;
  }

  return data?.id || null;
}

/**
 * Upload an image to Supabase storage
 */
export async function uploadImage(
  vehicleId: string,
  imagePath: string,
  imageBuffer: Buffer,
  mimeType: string
): Promise<string | null> {
  const client = initSupabase();

  const ext = mimeType.split('/')[1] || 'jpg';
  const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
  const storagePath = `archive/${vehicleId}/${filename}`;

  const { error: uploadError } = await client.storage
    .from('vehicle-images')
    .upload(storagePath, imageBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error(`Failed to upload image: ${uploadError.message}`);
    return null;
  }

  // Get public URL
  const { data: urlData } = client.storage
    .from('vehicle-images')
    .getPublicUrl(storagePath);

  return urlData?.publicUrl || null;
}

/**
 * Create a vehicle image record
 */
export async function createVehicleImage(
  vehicleId: string,
  imageUrl: string,
  metadata: {
    source_url?: string;
    category?: string;
    position?: number;
  } = {}
): Promise<void> {
  const client = initSupabase();

  await client.from('vehicle_images').insert({
    vehicle_id: vehicleId,
    url: imageUrl,
    category: metadata.category || 'general',
    metadata: {
      source: 'craigslist_archive',
      original_url: metadata.source_url,
      position: metadata.position,
    },
  });
}

/**
 * Get import batch by ID
 */
export async function getImportBatch(batchId: string): Promise<ImportBatch | null> {
  const client = initSupabase();

  const { data, error } = await client
    .from('archive_imports')
    .select('*')
    .eq('id', batchId)
    .single();

  if (error) {
    console.error(`Failed to get import batch: ${error.message}`);
    return null;
  }

  return data;
}

/**
 * Complete an import batch
 */
export async function completeImportBatch(
  batchId: string,
  stats: {
    files_processed: number;
    files_failed: number;
    vehicles_created: number;
    vehicles_updated: number;
    contacts_created: number;
    timeline_events_created: number;
  }
): Promise<void> {
  const client = initSupabase();

  await client
    .from('archive_imports')
    .update({
      ...stats,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', batchId);
}

/**
 * Check if a vehicle already exists by URL or post ID
 */
export async function vehicleExistsByPostId(postId: string): Promise<string | null> {
  const client = initSupabase();

  const { data } = await client
    .from('vehicles')
    .select('id')
    .contains('origin_metadata', { craigslist_post_id: postId })
    .single();

  return data?.id || null;
}
