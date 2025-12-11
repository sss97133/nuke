#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Remote Supabase configuration
const REMOTE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const REMOTE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// Local Supabase configuration
const LOCAL_URL = process.env.LOCAL_SUPABASE_URL || 'http://localhost:54321';
const LOCAL_ANON_KEY = process.env.LOCAL_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const remoteSupabase = createClient(REMOTE_URL, REMOTE_ANON_KEY);
const localSupabase = createClient(LOCAL_URL, LOCAL_ANON_KEY);

const vehicleId = 'e7ed3e29-456a-43ea-843d-2dc0468ea4ca';

async function uploadImagesToRemote() {
  console.log('Starting image upload to remote Supabase...');

  try {
    // First, create the bucket if it doesn't exist
    console.log('Creating vehicle-data bucket...');
    const { data: buckets } = await remoteSupabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.id === 'vehicle-data');
    
    if (!bucketExists) {
      const { data: bucket, error: bucketError } = await remoteSupabase.storage.createBucket('vehicle-data', {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        fileSizeLimit: 10485760 // 10MB
      });
      
      if (bucketError) {
        console.error('Failed to create bucket:', bucketError);
        return;
      }
      console.log('✅ Created vehicle-data bucket');
    } else {
      console.log('✅ vehicle-data bucket already exists');
    }

    // List files from local storage
    console.log('Listing files from local storage...');
    const { data: files, error: listError } = await localSupabase.storage
      .from('vehicle-data')
      .list(`vehicles/${vehicleId}/images`, { limit: 1000 });

    if (listError) {
      console.error('Failed to list local files:', listError);
      return;
    }

    if (!files || files.length === 0) {
      console.log('No files found in local storage');
      return;
    }

    console.log(`Found ${files.length} files to upload`);

    // Upload each file
    for (const file of files) {
      if (!file.name) continue;
      
      const localPath = `vehicles/${vehicleId}/images/${file.name}`;
      const remotePath = `vehicles/${vehicleId}/images/${file.name}`;
      
      console.log(`Uploading ${file.name}...`);
      
      try {
        // Download from local
        const { data: fileData, error: downloadError } = await localSupabase.storage
          .from('vehicle-data')
          .download(localPath);

        if (downloadError) {
          console.error(`Failed to download ${file.name}:`, downloadError);
          continue;
        }

        // Upload to remote
        const { data: uploadData, error: uploadError } = await remoteSupabase.storage
          .from('vehicle-data')
          .upload(remotePath, fileData, {
            cacheControl: '3600',
            upsert: true
          });

        if (uploadError) {
          console.error(`Failed to upload ${file.name}:`, uploadError);
          continue;
        }

        console.log(`✅ Uploaded ${file.name}`);
      } catch (err) {
        console.error(`Error processing ${file.name}:`, err);
      }
    }

    console.log('✅ Upload complete!');
    
    // Test one image URL
    const testUrl = `${REMOTE_URL}/storage/v1/object/public/vehicle-data/vehicles/${vehicleId}/images/${files[0].name}`;
    console.log(`Test URL: ${testUrl}`);
    
  } catch (error) {
    console.error('Upload failed:', error);
  }
}

uploadImagesToRemote();
