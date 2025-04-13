// Script to directly create database structure and fix migration issues
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Supabase connection details
const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'; // Use service_role key

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixDatabase() {
  console.log('🔧 Starting database fix...');
  
  try {
    // 1. Reset the database to start from a clean state
    console.log('🗑️ Resetting Supabase database...');
    await execAsync('npx supabase db reset --no-migrations');
    console.log('✅ Database reset successfully');
    
    // 2. Apply essential schema manually
    console.log('🏗️ Creating vehicles table with proper structure...');
    
    // Create vehicles table with owner_id
    const { error: createTableError } = await supabase.rpc('exec', { 
      query: `
        CREATE TABLE IF NOT EXISTS public.vehicles (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
          title TEXT,
          description TEXT,
          status TEXT DEFAULT 'active',
          ownership_status TEXT,
          year TEXT,
          make TEXT,
          model TEXT,
          trim TEXT,
          vin TEXT,
          notes TEXT,
          added_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );
        
        -- Create index on owner_id
        CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id ON public.vehicles(owner_id);
        
        -- Enable RLS
        ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
        
        -- Add RLS policies
        CREATE POLICY "Users can insert their own vehicles" 
          ON public.vehicles 
          FOR INSERT 
          TO authenticated 
          WITH CHECK (auth.uid() = owner_id);
          
        CREATE POLICY "Users can view their own vehicles" 
          ON public.vehicles 
          FOR SELECT 
          TO authenticated 
          USING (auth.uid() = owner_id);
          
        CREATE POLICY "Users can update their own vehicles" 
          ON public.vehicles 
          FOR UPDATE 
          TO authenticated 
          USING (auth.uid() = owner_id)
          WITH CHECK (auth.uid() = owner_id);
          
        CREATE POLICY "Users can delete their own vehicles" 
          ON public.vehicles 
          FOR DELETE 
          TO authenticated 
          USING (auth.uid() = owner_id);
      `
    });
    
    if (createTableError) {
      console.error('❌ Error creating vehicles table:', createTableError);
      return;
    }
    
    // 3. Create storage bucket for vehicle images
    console.log('📦 Setting up storage buckets...');
    const { error: bucketError } = await supabase.storage.createBucket('vehicle-images', { 
      public: true,
      fileSizeLimit: 52428800, // 50MB
    });
    
    if (bucketError && !bucketError.message.includes('already exists')) {
      console.error('❌ Error creating storage bucket:', bucketError);
    } else {
      console.log('✅ Storage bucket created or already exists');
    }
    
    // 4. Check if schema was applied successfully
    console.log('🔍 Verifying database setup...');
    const { data: tables, error: tablesError } = await supabase
      .from('pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');
      
    if (tablesError) {
      console.error('❌ Error verifying tables:', tablesError);
      return;
    }
    
    console.log('📋 Tables in database:', tables.map(t => t.tablename).join(', '));
    
    // Skip creating any test/mock vehicles as per user preference
    console.log('🚫 Skipping test vehicle creation - using real data only as per preference');
    
    
    console.log('🎉 Database fix complete!');
    console.log('🔑 Your local Supabase is now ready for development.');
    console.log('📊 Access Supabase Studio at: http://127.0.0.1:54323');
    
  } catch (error) {
    console.error('❌ Error during database fix:', error);
  }
}

fixDatabase();
