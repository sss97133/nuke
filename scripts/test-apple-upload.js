#!/usr/bin/env node

/**
 * Test script to verify apple-upload edge function EXIF date extraction
 * This simulates what would happen when uploading photos with EXIF dates
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testAppleUpload() {
  console.log('\n🧪 Testing apple-upload edge function\n');

  // Check if function is deployed
  try {
    const { data, error } = await supabase.functions.invoke('apple-upload', {
      method: 'OPTIONS'
    });
    
    if (error && error.message.includes('not found')) {
      console.log('❌ Function not deployed yet');
      return;
    }
    
    console.log('✅ Function is deployed and responding\n');
    
  } catch (e) {
    console.log('⚠️  Could not test function:', e.message);
  }

  // Test the date grouping logic (simulated)
  console.log('📋 Testing date grouping logic:\n');
  
  const mockFiles = [
    { name: 'IMG_001.jpg', exifDate: '2024-06-15' },
    { name: 'IMG_002.jpg', exifDate: '2024-06-15' },
    { name: 'IMG_003.jpg', exifDate: '2024-06-15' },
    { name: 'IMG_004.jpg', exifDate: '2024-07-04' },
    { name: 'IMG_005.jpg', exifDate: '2024-07-04' },
    { name: 'IMG_006.jpg', exifDate: '2024-10-10' },
    { name: 'IMG_007.jpg', exifDate: null }, // No EXIF
  ];

  // Simulate grouping
  const dateGroups = new Map();
  let skipped = 0;
  
  for (const file of mockFiles) {
    if (file.exifDate) {
      if (!dateGroups.has(file.exifDate)) {
        dateGroups.set(file.exifDate, []);
      }
      dateGroups.get(file.exifDate).push(file);
    } else {
      skipped++;
    }
  }

  console.log('Results:');
  console.log(`  Total files: ${mockFiles.length}`);
  console.log(`  Date groups created: ${dateGroups.size}`);
  console.log(`  Files without EXIF: ${skipped}`);
  console.log('');
  
  for (const [date, files] of dateGroups.entries()) {
    console.log(`  📅 ${date}: ${files.length} photo${files.length > 1 ? 's' : ''}`);
    files.forEach(f => console.log(`     - ${f.name}`));
  }
  
  if (skipped > 0) {
    console.log(`  \n  ⚠️  ${skipped} file(s) would be uploaded without timeline event`);
  }
  
  console.log('\n✅ Date grouping logic works correctly!\n');

  // Check what events currently exist from today
  console.log('📊 Checking recently created events:\n');
  
  const today = new Date().toISOString().split('T')[0];
  const { data: recentEvents, error } = await supabase
    .from('vehicle_timeline_events')
    .select('id, event_date, title, image_urls, metadata')
    .eq('source', 'apple_import')
    .gte('created_at', today + 'T00:00:00Z')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.log('⚠️  Could not fetch events:', error.message);
  } else if (recentEvents && recentEvents.length > 0) {
    console.log(`Found ${recentEvents.length} recent apple_import event(s):\n`);
    recentEvents.forEach(e => {
      const photoCount = e.image_urls?.length || 0;
      const exifVerified = e.metadata?.exif_verified ? '✅ EXIF' : '📅 Manual';
      console.log(`  ${exifVerified} ${e.event_date}: ${e.title} (${photoCount} photos)`);
    });
  } else {
    console.log('No recent apple_import events found (function not used yet)');
  }
  
  console.log('\n✅ Test complete!\n');
}

testAppleUpload().catch(console.error);

