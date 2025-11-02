// Retroactive Fix: Dropbox Import Attribution
// Fixes existing Dropbox-imported images to properly attribute to ghost users

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const IMPORTER_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // Skylar

/**
 * Extract device fingerprint from existing EXIF data
 */
function extractDeviceFingerprint(exifData) {
  if (!exifData) return null;

  const make = exifData.Make || null;
  const model = exifData.Model || null;
  const lens = exifData.LensModel || null;
  const software = exifData.Software || null;

  const parts = [make, model, lens, software].filter(Boolean);
  if (parts.length === 0) return null;

  return {
    fingerprint: parts.join('-'),
    make,
    model,
    lens,
    software
  };
}

/**
 * Find or create a ghost user for this camera device
 */
async function getOrCreateGhostUser(deviceInfo) {
  if (!deviceInfo || !deviceInfo.fingerprint) {
    return null;
  }

  // Try to find existing ghost user
  const { data: existingGhost } = await supabase
    .from('ghost_users')
    .select('id, device_fingerprint, display_name')
    .eq('device_fingerprint', deviceInfo.fingerprint)
    .maybeSingle();

  if (existingGhost) {
    console.log(`   Found ghost user: ${existingGhost.display_name || existingGhost.id}`);
    return existingGhost.id;
  }

  // Create new ghost user
  const displayName = deviceInfo.model 
    ? `${deviceInfo.make || 'Camera'} ${deviceInfo.model}`.trim()
    : `Unknown Device ${deviceInfo.fingerprint.substring(0, 8)}`;

  const { data: newGhost, error } = await supabase
    .from('ghost_users')
    .insert({
      device_fingerprint: deviceInfo.fingerprint,
      camera_make: deviceInfo.make,
      camera_model: deviceInfo.model,
      lens_model: deviceInfo.lens,
      software_version: deviceInfo.software,
      display_name: displayName,
      total_contributions: 0
    })
    .select('id')
    .single();

  if (error) {
    console.error(`   Error creating ghost user: ${error.message}`);
    return null;
  }

  console.log(`   Created ghost user: ${displayName}`);
  return newGhost.id;
}

async function fixAttribution() {
  console.log('🔧 Fixing Dropbox import attribution retroactively...\n');

  try {
    // 1. Find all images imported via Dropbox that are attributed to the importer
    const { data: images, error: fetchError } = await supabase
      .from('vehicle_images')
      .select('id, vehicle_id, user_id, exif_data, image_url, taken_at')
      .eq('source', 'dropbox_import')
      .eq('user_id', IMPORTER_USER_ID);

    if (fetchError) throw fetchError;

    console.log(`📊 Found ${images.length} images to fix\n`);

    if (images.length === 0) {
      console.log('✅ No images need fixing!');
      return;
    }

    let fixed = 0;
    let skipped = 0;
    let errors = 0;

    for (const img of images) {
      try {
        console.log(`\n🖼️  Processing image: ${img.id.substring(0, 8)}...`);

        // Extract device info from EXIF
        const deviceInfo = extractDeviceFingerprint(img.exif_data);

        if (!deviceInfo) {
          console.log('   ⏭️  No device fingerprint in EXIF - keeping current attribution');
          skipped++;
          continue;
        }

        // Get or create ghost user
        const ghostUserId = await getOrCreateGhostUser(deviceInfo);

        if (!ghostUserId) {
          console.log('   ⚠️  Could not create ghost user - keeping current attribution');
          skipped++;
          continue;
        }

        // Update attribution
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({
            user_id: ghostUserId,
            imported_by: IMPORTER_USER_ID,
            exif_data: {
              ...img.exif_data,
              device_fingerprint: deviceInfo.fingerprint,
              attribution_fixed: true,
              attribution_fixed_at: new Date().toISOString(),
              previous_attribution: IMPORTER_USER_ID
            }
          })
          .eq('id', img.id);

        if (updateError) throw updateError;

        console.log(`   ✅ Fixed: Now attributed to ghost user ${ghostUserId.substring(0, 8)}`);
        fixed++;

      } catch (imgError) {
        console.error(`   ❌ Error: ${imgError.message}`);
        errors++;
      }
    }

    // 2. Fix vehicle.uploaded_by -> vehicles.imported_by for vehicles created via Dropbox
    console.log(`\n\n🚗 Fixing vehicle attribution...`);

    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, uploaded_by')
      .eq('uploaded_by', IMPORTER_USER_ID)
      .in('id', images.map(img => img.vehicle_id).filter(Boolean));

    if (vehiclesError) throw vehiclesError;

    console.log(`📊 Found ${vehicles.length} vehicles to check\n`);

    let vehiclesFixed = 0;
    for (const vehicle of vehicles) {
      // Check if vehicle was created via Dropbox import (has dropbox_import images)
      const { count } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id)
        .eq('source', 'dropbox_import');

      if (count > 0) {
        // This vehicle was created via Dropbox import
        // Move uploaded_by to imported_by
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            imported_by: IMPORTER_USER_ID,
            uploaded_by: null, // Clear this since it was automated
            discovered_by: null // Clear this too - automation != discovery
          })
          .eq('id', vehicle.id);

        if (updateError) {
          console.error(`   ❌ Error updating vehicle ${vehicle.id}: ${updateError.message}`);
        } else {
          console.log(`   ✅ Fixed vehicle ${vehicle.id.substring(0, 8)}`);
          vehiclesFixed++;
        }
      }
    }

    console.log(`\n\n✅ RETROACTIVE FIX COMPLETE!`);
    console.log(`   Images fixed: ${fixed}`);
    console.log(`   Images skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Vehicles fixed: ${vehiclesFixed}`);

  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  }
}

fixAttribution();

