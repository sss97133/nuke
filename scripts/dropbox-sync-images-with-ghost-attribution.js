// Dropbox Image Sync for Viva's Inventory (Ghost User Attribution Fixed)
// Fetches images from Dropbox and uploads to vehicle profiles
// PROPERLY attributes images to ghost users based on EXIF, not the importer

import { createClient } from '@supabase/supabase-js';
import { Dropbox } from 'dropbox';
import fetch from 'node-fetch';
import ExifReader from 'exifreader';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;

if (!supabaseUrl || !supabaseKey || !dropboxToken) {
  console.error('Missing required environment variables');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DROPBOX_ACCESS_TOKEN');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const dbx = new Dropbox({ accessToken: dropboxToken, fetch });

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const INVENTORY_PATH = '/Yucca Car Inventory';
const IMPORTER_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // Skylar (automator, NOT contributor)

/**
 * Extract EXIF data and create device fingerprint
 */
function extractDeviceFingerprint(exifData) {
  const make = exifData.Make?.description || null;
  const model = exifData.Model?.description || null;
  const lens = exifData.LensModel?.description || null;
  const software = exifData.Software?.description || null;

  // Create fingerprint: Make-Model-Lens-Software
  const parts = [make, model, lens, software].filter(Boolean);
  const fingerprint = parts.join('-');

  return {
    fingerprint,
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
  if (!deviceInfo.fingerprint) {
    console.log('   ⚠️  No device fingerprint - using organization as fallback');
    return null;
  }

  // Try to find existing ghost user
  const { data: existingGhost } = await supabase
    .from('ghost_users')
    .select('id, device_fingerprint, display_name')
    .eq('device_fingerprint', deviceInfo.fingerprint)
    .maybeSingle();

  if (existingGhost) {
    console.log(`   👻 Found ghost user: ${existingGhost.display_name || existingGhost.id}`);
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
    console.error('   ❌ Error creating ghost user:', error.message);
    return null;
  }

  console.log(`   ✨ Created ghost user: ${displayName} (${newGhost.id})`);
  return newGhost.id;
}

/**
 * Extract taken_at date from EXIF
 */
function extractTakenAt(exifData) {
  const dateFields = ['DateTimeOriginal', 'CreateDate', 'DateCreated'];
  
  for (const field of dateFields) {
    if (exifData[field]?.description) {
      try {
        const dateStr = exifData[field].description;
        return new Date(dateStr).toISOString();
      } catch (e) {
        // Continue to next field
      }
    }
  }
  
  return new Date().toISOString();
}

async function syncImages() {
  console.log('🔄 Starting Dropbox image sync with PROPER ATTRIBUTION...\n');

  try {
    // 1. Get all vehicles linked to Viva with 0 images
    const { data: orgVehicles, error: vehiclesError } = await supabase
      .from('organization_vehicles')
      .select(`
        vehicle_id,
        vehicles:vehicle_id (
          id,
          year,
          make,
          model,
          vin
        )
      `)
      .eq('organization_id', VIVA_ORG_ID)
      .eq('status', 'active');

    if (vehiclesError) throw vehiclesError;

    console.log(`📊 Found ${orgVehicles.length} vehicles linked to Viva`);

    // Check which ones need images
    const vehiclesNeedingImages = [];
    for (const ov of orgVehicles) {
      const vehicle = ov.vehicles;
      if (!vehicle) continue;

      const { count } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id);

      if (count === 0) {
        vehiclesNeedingImages.push(vehicle);
      }
    }

    console.log(`📸 ${vehiclesNeedingImages.length} vehicles need images\n`);

    if (vehiclesNeedingImages.length === 0) {
      console.log('✅ All vehicles have images!');
      return;
    }

    // 2. List all folders in Dropbox inventory
    console.log(`📂 Scanning Dropbox: ${INVENTORY_PATH}...`);
    const foldersResponse = await dbx.filesListFolder({
      path: INVENTORY_PATH,
      recursive: false
    });

    const vehicleFolders = foldersResponse.result.entries.filter(
      entry => entry['.tag'] === 'folder'
    );

    console.log(`📁 Found ${vehicleFolders.length} vehicle folders in Dropbox\n`);

    // 3. Match and upload images
    let totalUploaded = 0;
    let vehiclesProcessed = 0;
    let ghostAttributionCount = 0;

    for (const vehicle of vehiclesNeedingImages) {
      const vehicleString = `${vehicle.year} ${vehicle.make} ${vehicle.model}`.toLowerCase();
      
      // Find matching folder
      const matchingFolder = vehicleFolders.find(folder => {
        const folderName = folder.name.toLowerCase();
        return folderName.includes(vehicle.year?.toString() || '') &&
               folderName.includes(vehicle.make?.toLowerCase() || '') &&
               folderName.includes(vehicle.model?.toLowerCase() || '');
      });

      if (!matchingFolder) {
        console.log(`⏭  No Dropbox folder for: ${vehicleString}`);
        continue;
      }

      console.log(`\n🚗 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      console.log(`   Folder: ${matchingFolder.name}`);

      // Get images in folder
      const folderContents = await dbx.filesListFolder({
        path: matchingFolder.path_lower,
        recursive: false
      });

      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic'];
      const imageFiles = folderContents.result.entries.filter(entry => {
        if (entry['.tag'] !== 'file') return false;
        const ext = entry.name.toLowerCase().substring(entry.name.lastIndexOf('.'));
        return imageExtensions.includes(ext);
      });

      console.log(`   Found ${imageFiles.length} images`);

      let uploadedCount = 0;
      for (const img of imageFiles) {
        try {
          // Get temporary download link
          const linkResponse = await dbx.filesGetTemporaryLink({
            path: img.path_lower
          });

          // Download image
          const imageResponse = await fetch(linkResponse.result.link);
          const imageBuffer = await imageResponse.buffer();
          const imageArrayBuffer = imageBuffer.buffer.slice(
            imageBuffer.byteOffset,
            imageBuffer.byteOffset + imageBuffer.byteLength
          );

          console.log(`   📥 Downloaded: ${img.name} (${(imageBuffer.length / 1024).toFixed(1)}KB)`);

          // Extract EXIF data
          let exifData = {};
          let deviceInfo = { fingerprint: null };
          let ghostUserId = null;
          let takenAt = new Date().toISOString();

          try {
            const tags = ExifReader.load(imageArrayBuffer);
            exifData = tags;
            deviceInfo = extractDeviceFingerprint(tags);
            takenAt = extractTakenAt(tags);
            
            // Get or create ghost user
            ghostUserId = await getOrCreateGhostUser(deviceInfo);
            
            if (ghostUserId) {
              ghostAttributionCount++;
            }
          } catch (exifError) {
            console.log(`   ⚠️  No EXIF data extracted: ${exifError.message}`);
          }

          // Upload to Supabase storage
          const fileExt = img.name.split('.').pop();
          const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
          const storagePath = `vehicles/${vehicle.id}/dropbox/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('vehicle-data')
            .upload(storagePath, imageBuffer);

          if (uploadError) throw uploadError;

          const publicUrl = supabase.storage
            .from('vehicle-data')
            .getPublicUrl(storagePath).data.publicUrl;

          // CRITICAL: Attribute to ghost user (photographer) NOT importer
          const { error: insertError } = await supabase
            .from('vehicle_images')
            .insert({
              vehicle_id: vehicle.id,
              user_id: ghostUserId || IMPORTER_USER_ID, // Ghost user if available, fallback to importer
              imported_by: IMPORTER_USER_ID, // Track who ran the automation
              image_url: publicUrl,
              category: 'general',
              source: 'dropbox_import',
              taken_at: takenAt,
              exif_data: {
                ...exifData,
                dropbox_path: img.path_lower,
                dropbox_filename: img.name,
                original_size: img.size,
                device_fingerprint: deviceInfo.fingerprint,
                attribution_method: ghostUserId ? 'ghost_user' : 'fallback_importer'
              }
            });

          if (insertError) throw insertError;

          uploadedCount++;
          totalUploaded++;
          console.log(`   ✅ Uploaded ${uploadedCount}/${imageFiles.length}${ghostUserId ? ' (ghost attributed)' : ''}`);

        } catch (imgError) {
          console.error(`   ❌ Error with ${img.name}:`, imgError.message);
        }
      }

      vehiclesProcessed++;
      console.log(`   📸 Complete: ${uploadedCount}/${imageFiles.length} images uploaded`);
    }

    console.log(`\n✅ SYNC COMPLETE!`);
    console.log(`   Vehicles processed: ${vehiclesProcessed}`);
    console.log(`   Total images uploaded: ${totalUploaded}`);
    console.log(`   Ghost user attributions: ${ghostAttributionCount}`);
    console.log(`   Fallback attributions: ${totalUploaded - ghostAttributionCount}`);

  } catch (error) {
    console.error('❌ Sync failed:', error);
    throw error;
  }
}

syncImages();

