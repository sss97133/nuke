// Dropbox Image Sync for Viva's Inventory
// Fetches images from Dropbox and uploads to vehicle profiles

import { createClient } from '@supabase/supabase-js';
import { Dropbox } from 'dropbox';
import fetch from 'node-fetch';

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
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // Your user ID

async function syncImages() {
  console.log('🔄 Starting Dropbox image sync for Viva inventory...\n');

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
          const imageBlob = new Blob([imageBuffer]);

          console.log(`   📥 Downloaded: ${img.name} (${(imageBuffer.length / 1024).toFixed(1)}KB)`);

          // Upload to Supabase storage
          const fileExt = img.name.split('.').pop();
          const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
          const storagePath = `vehicles/${vehicle.id}/dropbox/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('vehicle-data')
            .upload(storagePath, imageBlob);

          if (uploadError) throw uploadError;

          const publicUrl = supabase.storage
            .from('vehicle-data')
            .getPublicUrl(storagePath).data.publicUrl;

          // Insert into vehicle_images
          const { error: insertError } = await supabase
            .from('vehicle_images')
            .insert({
              vehicle_id: vehicle.id,
              user_id: USER_ID,
              image_url: publicUrl,
              category: 'general',
              source: 'dropbox_import',
              exif_data: {
                dropbox_path: img.path_lower,
                dropbox_filename: img.name,
                original_size: img.size
              }
            });

          if (insertError) throw insertError;

          uploadedCount++;
          totalUploaded++;
          console.log(`   ✅ Uploaded ${uploadedCount}/${imageFiles.length}`);

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

  } catch (error) {
    console.error('❌ Sync failed:', error);
    throw error;
  }
}

syncImages();

