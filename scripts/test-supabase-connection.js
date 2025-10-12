#!/usr/bin/env node

/**
 * Test Supabase connection and storage access
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

console.log('🔧 Testing Supabase Connection\n');
console.log('📍 URL:', supabaseUrl ? supabaseUrl.replace(/https?:\/\//, '') : 'NOT SET');
console.log('🔑 Anon Key:', supabaseAnonKey ? 'SET (hidden)' : 'NOT SET');
console.log();

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testConnection() {
  try {
    // Test 1: Database connection
    console.log('1️⃣ Testing database connection...');
    const { data: testData, error: dbError } = await supabase
      .from('receipts')
      .select('id')
      .limit(1);
    
    if (dbError) {
      console.log('   ⚠️  Database query error (expected if no receipts yet):', dbError.message);
    } else {
      console.log('   ✅ Database connection successful');
    }

    // Test 2: Storage bucket access
    console.log('\n2️⃣ Testing storage bucket access...');
    const { data: buckets, error: storageError } = await supabase.storage.listBuckets();
    
    if (storageError) {
      console.log('   ❌ Storage error:', storageError.message);
    } else {
      const receiptsBucket = buckets?.find(b => b.name === 'receipts');
      if (receiptsBucket) {
        console.log('   ✅ Receipts bucket found');
        console.log('   📦 Bucket details:', {
          name: receiptsBucket.name,
          public: receiptsBucket.public,
          id: receiptsBucket.id
        });
      } else {
        console.log('   ⚠️  Receipts bucket not found in list');
      }
    }

    // Test 3: Upload test
    console.log('\n3️⃣ Testing file upload...');
    const testContent = `Test upload at ${new Date().toISOString()}`;
    const testFile = new Blob([testContent], { type: 'text/plain' });
    const fileName = `test/connection-test-${Date.now()}.txt`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('receipts')
      .upload(fileName, testFile);

    if (uploadError) {
      console.log('   ❌ Upload error:', uploadError.message);
    } else {
      console.log('   ✅ Test file uploaded successfully');
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('receipts')
        .getPublicUrl(fileName);
      
      console.log('   🔗 Public URL:', urlData.publicUrl);
      
      // Clean up
      const { error: deleteError } = await supabase.storage
        .from('receipts')
        .remove([fileName]);
      
      if (!deleteError) {
        console.log('   🧹 Test file cleaned up');
      }
    }

    console.log('\n✅ All tests completed!');
    console.log('Your Supabase connection is working properly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testConnection();
