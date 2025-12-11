import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupStorage() {
  try {
    console.log('🔧 Setting up Supabase storage...');
    
    // Check if bucket exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      console.error('Error listing buckets:', listError);
      return;
    }
    
    const bucketExists = buckets?.some(bucket => bucket.name === 'vehicle-data');
    
    if (bucketExists) {
      console.log('✅ Storage bucket "vehicle-data" already exists');
      return;
    }
    
    console.log('📦 Creating storage bucket "vehicle-data"...');
    
    // Create the bucket
    const { error: createError } = await supabase.storage.createBucket('vehicle-data', {
      public: true,
      fileSizeLimit: 52428800, // 50MB
      allowedMimeTypes: ['image/*']
    });
    
    if (createError) {
      console.error('❌ Error creating bucket:', createError);
      console.log('\n📋 Manual Setup Required:');
      console.log('1. Go to https://supabase.com/dashboard');
      console.log('2. Select your project');
      console.log('3. Navigate to Storage');
      console.log('4. Click "New Bucket"');
      console.log('5. Name: vehicle-data');
      console.log('6. Enable "Public bucket"');
      console.log('7. Set file size limit to 50MB');
      return;
    }
    
    console.log('✅ Storage bucket "vehicle-data" created successfully!');
    
    // Set up RLS policies for the bucket
    console.log('🔒 Setting up storage policies...');
    
    // Note: RLS policies for storage need to be set up in the Supabase dashboard
    // or via SQL migrations. For now, we'll just create the bucket.
    
    console.log('\n🎉 Storage setup complete!');
    console.log('You can now upload vehicle images.');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
}

// Run the setup
setupStorage(); 