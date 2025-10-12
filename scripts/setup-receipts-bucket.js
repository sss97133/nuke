#!/usr/bin/env node

/**
 * Setup receipts storage bucket in Supabase
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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables:');
  console.error('   VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗');
  console.error('\nPlease add SUPABASE_SERVICE_ROLE_KEY to your .env file');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function setupReceiptsBucket() {
  try {
    console.log('🔧 Setting up receipts storage bucket...\n');

    // Check if bucket exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      console.error('❌ Error listing buckets:', listError);
      return;
    }

    const bucketExists = buckets?.some(b => b.name === 'receipts');
    
    if (bucketExists) {
      console.log('✅ Receipts bucket already exists');
      
      // Update bucket configuration to ensure it's public
      const { data, error } = await supabase.storage.updateBucket('receipts', {
        public: true,
        fileSizeLimit: 52428800, // 50MB
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          'image/heic',
          'application/pdf',
          'text/plain'
        ]
      });

      if (error) {
        console.error('❌ Error updating bucket:', error);
      } else {
        console.log('✅ Bucket configuration updated');
      }
    } else {
      // Create the bucket
      const { data, error } = await supabase.storage.createBucket('receipts', {
        public: true,
        fileSizeLimit: 52428800, // 50MB
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          'image/heic',
          'application/pdf',
          'text/plain'
        ]
      });

      if (error) {
        console.error('❌ Error creating bucket:', error);
        return;
      }

      console.log('✅ Receipts bucket created successfully');
    }

    // Test upload capability
    console.log('\n📝 Testing upload capability...');
    const testFile = new Blob(['test'], { type: 'text/plain' });
    const testFileName = `test_${Date.now()}.txt`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('receipts')
      .upload(testFileName, testFile);

    if (uploadError) {
      console.error('❌ Test upload failed:', uploadError);
    } else {
      console.log('✅ Test upload successful');
      
      // Clean up test file
      const { error: deleteError } = await supabase.storage
        .from('receipts')
        .remove([testFileName]);
      
      if (!deleteError) {
        console.log('✅ Test file cleaned up');
      }
    }

    console.log('\n✅ Receipts bucket is ready to use!');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
}

setupReceiptsBucket();
