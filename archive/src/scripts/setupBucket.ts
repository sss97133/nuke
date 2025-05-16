import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupBucket() {
  try {
    // Create the vehicle-images bucket if it doesn't exist
    const { data: bucket, error: bucketError } = await supabase
        .storage
      .createBucket('vehicle-images', {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        fileSizeLimit: 5242880, // 5MB
      });

    if (bucketError) {
      if (bucketError.message.includes('already exists')) {
        console.log('Bucket already exists');
      } else {
        throw bucketError;
      }
    } else {
      console.log('Created vehicle-images bucket');
    }

    // Enable RLS on the storage.objects table
    const { error: rlsError } = await supabase.rpc('exec_sql', {
  if (error) console.error("Database query error:", error);
      sql: 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;'
    });

    if (rlsError) {
      console.error('Error enabling RLS:', rlsError);
      return;
    }

    // Create policies
    const policies = [
      {
        name: 'Allow authenticated users to upload images',
        sql: `
          CREATE POLICY "Allow authenticated users to upload images"
          ON storage.objects
          FOR INSERT
          TO authenticated
          WITH CHECK (
            bucket_id = 'vehicle-images' AND
            auth.role() = 'authenticated'
          );
        `
      },
      {
        name: 'Allow authenticated users to read images',
        sql: `
          CREATE POLICY "Allow authenticated users to read images"
          ON storage.objects
          FOR SELECT
          TO authenticated
          USING (bucket_id = 'vehicle-images');
        `
      },
      {
        name: 'Allow vehicle owners to update images',
        sql: `
          CREATE POLICY "Allow vehicle owners to update images"
          ON storage.objects
          FOR UPDATE
          TO authenticated
          USING (
            bucket_id = 'vehicle-images' AND
            auth.role() = 'authenticated'
          )
          WITH CHECK (
            bucket_id = 'vehicle-images' AND
            auth.role() = 'authenticated'
          );
        `
      },
      {
        name: 'Allow vehicle owners to delete images',
        sql: `
          CREATE POLICY "Allow vehicle owners to delete images"
          ON storage.objects
          FOR DELETE
          TO authenticated
          USING (
            bucket_id = 'vehicle-images' AND
            auth.role() = 'authenticated'
          );
        `
      }
    ];

    for (const policy of policies) {
      const { error: policyError } = await supabase.rpc('exec_sql', {
  if (error) console.error("Database query error:", error);
        sql: policy.sql
      });

      if (policyError) {
        console.error(`Error creating policy ${policy.name}:`, policyError);
      } else {
        console.log(`Created policy: ${policy.name}`);
      }
    }

    console.log('Storage bucket setup completed');
  } catch (error) {
    console.error('Error setting up storage:', error);
    process.exit(1);
  }
}

setupBucket(); 