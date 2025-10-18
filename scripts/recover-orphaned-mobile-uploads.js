#!/usr/bin/env node

/**
 * Recover Orphaned Mobile Uploads
 * 
 * Finds images in storage with timestamp-based filenames (mobile uploads)
 * that aren't tracked in vehicle_images table, then creates proper records.
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Known orphaned images from your page
const orphanedImages = [
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753517180-0-IMG_6837.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753518795-1-IMG_6843.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753520860-2-IMG_6845.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753523370-3-IMG_6842.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753525698-4-IMG_6847.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753527445-5-IMG_6854.png', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753529889-6-IMG_6881.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753531963-7-IMG_6882.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753533789-8-IMG_6884.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753535784-9-IMG_6885.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753537827-10-IMG_6888.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753539806-11-IMG_6890.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753542035-12-IMG_6892.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753543890-13-IMG_6895.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753544392-14-IMG_7332.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753546281-15-IMG_7671.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753547868-16-IMG_7675.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753549440-17-IMG_7679.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753551037-18-IMG_7678.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753553308-19-IMG_7670.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753555669-20-IMG_7663.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753557508-21-IMG_7662.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' },
  { url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/1760753559153-22-IMG_7661.jpeg', vehicleId: '91f43050-2e6b-4fab-bf86-0f5e14da4fff' }
];

async function analyzeOrphanedImages() {
  console.log('Analyzing ' + orphanedImages.length + ' orphaned images...\n');
  
  // 1. Check if vehicle exists
  const vehicleId = orphanedImages[0].vehicleId;
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
  
  console.log('Vehicle Status:');
  if (vehicle) {
    console.log('   ✅ EXISTS: ' + vehicle.year + ' ' + vehicle.make + ' ' + vehicle.model);
  } else {
    console.log('   ❌ MISSING: Vehicle ID ' + vehicleId + ' does not exist\n');
    console.log('PROBLEM: Mobile upload created storage files but failed to:');
    console.log('  1. Create vehicle record');
    console.log('  2. Create vehicle_images records');
    console.log('  3. Create timeline events\n');
  }
  
  // 2. Check if any images are tracked
  let tracked = 0;
  for (const img of orphanedImages.slice(0, 5)) {  // Check first 5
    const { data } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('image_url', img.url)
      .single();
    
    if (data) tracked++;
  }
  
  console.log('Image Tracking Status:');
  console.log('   Tracked in database: ' + tracked + '/' + orphanedImages.length);
  console.log('   Orphaned (in storage only): ' + (orphanedImages.length - tracked));
  
  // 3. Extract timestamp from filename to see when uploaded
  const firstImage = orphanedImages[0];
  const timestamp = parseInt(firstImage.url.match(/\/(\d+)-/)[1]);
  const uploadDate = new Date(timestamp);
  
  console.log('\nUpload timestamp: ' + uploadDate.toISOString());
  console.log('Upload date: ' + uploadDate.toLocaleDateString());
  
  console.log('\n📋 RECOMMENDED ACTION:\n');
  console.log('Since vehicle record is missing, you need to:');
  console.log('  1. Create the vehicle in the database (add-vehicle page)');
  console.log('  2. Re-upload the 23 photos');
  console.log('  3. OR manually create vehicle + link these storage files\n');
}

analyzeOrphanedImages();