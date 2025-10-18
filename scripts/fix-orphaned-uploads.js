#!/usr/bin/env node

/**
 * Fix Orphaned Mobile Uploads
 * Recovers 23 images from failed upload by creating proper database records
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const orphanedImages = [
  '1760753517180-0-IMG_6837.jpeg',
  '1760753518795-1-IMG_6843.jpeg',
  '1760753520860-2-IMG_6845.jpeg',
  '1760753523370-3-IMG_6842.jpeg',
  '1760753525698-4-IMG_6847.jpeg',
  '1760753527445-5-IMG_6854.png',
  '1760753529889-6-IMG_6881.jpeg',
  '1760753531963-7-IMG_6882.jpeg',
  '1760753533789-8-IMG_6884.jpeg',
  '1760753535784-9-IMG_6885.jpeg',
  '1760753537827-10-IMG_6888.jpeg',
  '1760753539806-11-IMG_6890.jpeg',
  '1760753542035-12-IMG_6892.jpeg',
  '1760753543890-13-IMG_6895.jpeg',
  '1760753544392-14-IMG_7332.jpeg',
  '1760753546281-15-IMG_7671.jpeg',
  '1760753547868-16-IMG_7675.jpeg',
  '1760753549440-17-IMG_7679.jpeg',
  '1760753551037-18-IMG_7678.jpeg',
  '1760753553308-19-IMG_7670.jpeg',
  '1760753555669-20-IMG_7663.jpeg',
  '1760753557508-21-IMG_7662.jpeg',
  '1760753559153-22-IMG_7661.jpeg'
];

const baseUrl = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/';

async function recoverOrphanedUpload() {
  console.log('\n🔧 ORPHANED UPLOAD RECOVERY\n');
  console.log('═══════════════════════════════════════\n');
  
  // Step 1: User needs to tell us which vehicle these belong to
  console.log('STEP 1: Identify Vehicle\n');
  console.log('These 23 images were uploaded on Oct 18, 2025 at 2:11 AM');
  console.log('The upload created storage files but failed to create database records.\n');
  
  // Show existing vehicles to help identify
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin')
    .order('created_at', { ascending: false })
    .limit(10);
  
  console.log('Recent vehicles in database:\n');
  vehicles?.forEach((v, i) => {
    console.log('  ' + (i + 1) + '. ' + v.year + ' ' + v.make + ' ' + v.model + ' (VIN: ' + (v.vin || 'none') + ')');
    console.log('     ID: ' + v.id);
  });
  
  console.log('\n\nSTEP 2: Recovery Options\n');
  console.log('Option A: Link to Existing Vehicle');
  console.log('  Run: VEHICLE_ID=<id> node scripts/link-orphaned-images.js\n');
  
  console.log('Option B: Create New Vehicle + Link Images');
  console.log('  1. Go to n-zero.dev/add-vehicle');
  console.log('  2. Create the vehicle');
  console.log('  3. Run: VEHICLE_ID=<new-id> node scripts/link-orphaned-images.js\n');
  
  console.log('Option C: Delete Orphaned Files');
  console.log('  Run: node scripts/delete-orphaned-images.js\n');
  
  console.log('═══════════════════════════════════════\n');
}

recoverOrphanedUpload();

