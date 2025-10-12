#!/usr/bin/env node

/**
 * Fix Storage RLS policies using Supabase Admin API
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testStorageAccess() {
  console.log('🧪 Testing Storage Access\n');
  
  // Test 1: Check if we can list files in tool-data bucket
  console.log('1️⃣ Testing list operation...');
  const { data: listData, error: listError } = await supabase.storage
    .from('tool-data')
    .list('', {
      limit: 1
    });
  
  if (listError) {
    console.log('   ❌ List error:', listError.message);
  } else {
    console.log('   ✅ List successful');
  }

  // Test 2: Try uploading a file as authenticated user
  console.log('\n2️⃣ Testing authenticated upload...');
  
  // First, sign in as a test user (or use existing session)
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    console.log('   ⚠️  No authenticated user. Trying anonymous upload...');
    
    // Test anonymous upload
    const testFile = new Blob(['Test content'], { type: 'text/plain' });
    const fileName = `public/test-${Date.now()}.txt`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('tool-data')
      .upload(fileName, testFile);
    
    if (uploadError) {
      console.log('   ❌ Anonymous upload failed:', uploadError.message);
    } else {
      console.log('   ✅ Anonymous upload successful');
      
      // Clean up
      await supabase.storage.from('tool-data').remove([fileName]);
      console.log('   🧹 Test file cleaned up');
    }
  } else {
    console.log(`   👤 Authenticated as: ${user.email || user.id}`);
    
    // Test authenticated upload
    const testFile = new Blob(['Test content'], { type: 'text/plain' });
    const fileName = `${user.id}/test-${Date.now()}.txt`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('tool-data')
      .upload(fileName, testFile);
    
    if (uploadError) {
      console.log('   ❌ Authenticated upload failed:', uploadError.message);
      
      // Try public folder
      const publicFileName = `public/test-${Date.now()}.txt`;
      const { error: publicError } = await supabase.storage
        .from('tool-data')
        .upload(publicFileName, testFile);
      
      if (publicError) {
        console.log('   ❌ Public folder upload also failed:', publicError.message);
      } else {
        console.log('   ✅ Public folder upload worked');
        await supabase.storage.from('tool-data').remove([publicFileName]);
      }
    } else {
      console.log('   ✅ Authenticated upload successful');
      
      // Clean up
      await supabase.storage.from('tool-data').remove([fileName]);
      console.log('   🧹 Test file cleaned up');
    }
  }

  // Test 3: Check public URL generation
  console.log('\n3️⃣ Testing public URL generation...');
  const testPath = 'test/example.jpg';
  const { data: urlData } = supabase.storage
    .from('tool-data')
    .getPublicUrl(testPath);
  
  console.log('   ✅ Public URL:', urlData.publicUrl);

  console.log('\n📋 Summary:');
  console.log('The tool-data bucket is accessible but may have RLS restrictions.');
  console.log('To fix this, you need to:');
  console.log('1. Go to Supabase Dashboard > Storage > Policies');
  console.log('2. Select the tool-data bucket');
  console.log('3. Add a policy for INSERT with:');
  console.log('   - Name: "Allow authenticated uploads"');
  console.log('   - Policy: true (for all authenticated users)');
  console.log('   - Or use: (auth.role() = \'authenticated\')');
  console.log('\nAlternatively, the base64 fallback in the code will work.');
}

// Run the test
testStorageAccess();
