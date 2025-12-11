#!/usr/bin/env node

/**
 * Delete Orphaned Storage Files
 * Removes the 23 orphaned images from storage since they have no database records
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const orphanedFiles = [
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

async function deleteOrphanedFiles() {
  console.log('\n🗑️  DELETING ORPHANED STORAGE FILES\n');
  console.log('═══════════════════════════════════════\n');
  
  console.log('Deleting ' + orphanedFiles.length + ' orphaned files from storage...\n');
  
  let deleted = 0;
  let failed = 0;
  
  for (const fileName of orphanedFiles) {
    const { error } = await supabase.storage
      .from('vehicle-images')
      .remove([fileName]);
    
    if (error) {
      console.log('❌ Failed to delete: ' + fileName);
      console.log('   Error: ' + error.message);
      failed++;
    } else {
      console.log('✅ Deleted: ' + fileName);
      deleted++;
    }
  }
  
  console.log('\n═══════════════════════════════════════');
  console.log('\n📊 SUMMARY:\n');
  console.log('   Deleted: ' + deleted);
  console.log('   Failed: ' + failed);
  console.log('\n✅ Cleanup complete\n');
}

deleteOrphanedFiles();

