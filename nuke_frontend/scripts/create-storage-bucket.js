// Script to create the 'vehicle-data' storage bucket in Supabase
// Run with: node scripts/create-storage-bucket.js

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Supabase URL and service key are required.');
  console.error('Make sure REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_SERVICE_KEY are set in your .env file');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

async function createBucket() {
  try {
    // Check if bucket already exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      throw new Error(`Error listing buckets: ${listError.message}`);
    }
    
    const bucketName = 'vehicle-data';
    const bucketExists = buckets.some(bucket => bucket.name === bucketName);
    
    if (bucketExists) {
      console.log(`✅ Bucket '${bucketName}' already exists.`);
      return;
    }
    
    // Create the bucket
    const { data, error } = await supabase.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: 52428800, // 50MB
      allowedMimeTypes: [
        'image/jpeg', 
        'image/png', 
        'image/webp', 
        'image/gif', 
        'image/heic', 
        'application/pdf', 
        'application/json'
      ]
    });
    
    if (error) {
      throw new Error(`Error creating bucket: ${error.message}`);
    }
    
    console.log(`✅ Successfully created bucket '${bucketName}'`);
    
    // Optional: Create basic RLS policies
    console.log('Note: For production, you should set up proper Row Level Security (RLS) policies.');
    console.log('You can do this in the Supabase dashboard under Storage > Policies.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createBucket();
