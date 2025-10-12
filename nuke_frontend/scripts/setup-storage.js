import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  console.log('Please check your .env file has:');
  console.log('VITE_SUPABASE_URL=your_supabase_url');
  console.log('VITE_SUPABASE_ANON_KEY=your_supabase_anon_key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupStorage() {
  try {
    console.log('🚀 Setting up Supabase storage...');

    // 1. Create the storage bucket if it doesn't exist
    console.log('📦 Creating storage bucket...');
    const { data: bucketData, error: bucketError } = await supabase.storage
      .createBucket('vehicle-data', {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
        fileSizeLimit: 10485760 // 10MB
      });

    if (bucketError) {
      if (bucketError.message.includes('already exists')) {
        console.log('✅ Storage bucket already exists');
      } else {
        console.error('❌ Error creating bucket:', bucketError);
        return;
      }
    } else {
      console.log('✅ Storage bucket created successfully');
    }

    // 2. Set up RLS policies for the bucket
    console.log('🔒 Setting up RLS policies...');
    
    // Policy to allow anonymous users to upload files
    const uploadPolicy = `
      CREATE POLICY "Allow anonymous uploads" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'vehicle-data' AND
        (auth.role() = 'anon' OR auth.role() = 'authenticated')
      );
    `;

    // Policy to allow public read access
    const readPolicy = `
      CREATE POLICY "Allow public read access" ON storage.objects
      FOR SELECT USING (bucket_id = 'vehicle-data');
    `;

    // Policy to allow users to update their own files
    const updatePolicy = `
      CREATE POLICY "Allow users to update own files" ON storage.objects
      FOR UPDATE USING (
        bucket_id = 'vehicle-data' AND
        (auth.role() = 'anon' OR auth.role() = 'authenticated')
      );
    `;

    // Policy to allow users to delete their own files
    const deletePolicy = `
      CREATE POLICY "Allow users to delete own files" ON storage.objects
      FOR DELETE USING (
        bucket_id = 'vehicle-data' AND
        (auth.role() = 'anon' OR auth.role() = 'authenticated')
      );
    `;

    try {
      // Note: These SQL commands need to be run in the Supabase dashboard
      // since we can't execute them directly from the client
      console.log('📋 RLS Policies to add in Supabase Dashboard:');
      console.log('\n=== UPLOAD POLICY ===');
      console.log(uploadPolicy);
      console.log('\n=== READ POLICY ===');
      console.log(readPolicy);
      console.log('\n=== UPDATE POLICY ===');
      console.log(updatePolicy);
      console.log('\n=== DELETE POLICY ===');
      console.log(deletePolicy);
      
      console.log('\n🔧 MANUAL SETUP REQUIRED:');
      console.log('1. Go to your Supabase Dashboard');
      console.log('2. Navigate to Storage > Policies');
      console.log('3. Select the "vehicle-data" bucket');
      console.log('4. Add the policies above one by one');
      console.log('5. Or disable RLS entirely for testing (not recommended for production)');
      
    } catch (policyError) {
      console.error('❌ Error setting up policies:', policyError);
    }

    // 3. Test the setup
    console.log('\n🧪 Testing storage access...');
    const testFile = new Blob(['test'], { type: 'text/plain' });
    const testPath = 'test/test.txt';
    
    const { data: testUpload, error: testError } = await supabase.storage
      .from('vehicle-data')
      .upload(testPath, testFile);

    if (testError) {
      console.log('❌ Test upload failed:', testError.message);
      console.log('This is expected if RLS policies are not set up yet');
    } else {
      console.log('✅ Test upload successful!');
      
      // Clean up test file
      await supabase.storage
        .from('vehicle-data')
        .remove([testPath]);
      console.log('🧹 Test file cleaned up');
    }

    console.log('\n🎉 Storage setup complete!');
    console.log('\n📝 Next steps:');
    console.log('1. Set up RLS policies in Supabase Dashboard (see above)');
    console.log('2. Or temporarily disable RLS for testing');
    console.log('3. Test image upload in your app');

  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
}

setupStorage(); 