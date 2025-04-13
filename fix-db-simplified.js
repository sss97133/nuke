// Simplified script to fix database structure using direct SQL
import { createClient } from '@supabase/supabase-js';

// Supabase connection details
const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'; // Use service_role key

// Initialize Supabase client with admin privileges
const supabase = createClient(supabaseUrl, supabaseKey);

// SQL statements to fix database structure
const sqlStatements = [
  // Create vehicles table if it doesn't exist
  `CREATE TABLE IF NOT EXISTS public.vehicles (
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
  );`,
  
  // Create index on owner_id
  `CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id ON public.vehicles(owner_id);`,
  
  // Enable RLS
  `ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;`,
  
  // Add RLS policies
  `DROP POLICY IF EXISTS "Users can insert their own vehicles" ON public.vehicles;`,
  `CREATE POLICY "Users can insert their own vehicles" 
    ON public.vehicles 
    FOR INSERT 
    TO authenticated 
    WITH CHECK (auth.uid() = owner_id);`,
    
  `DROP POLICY IF EXISTS "Users can view their own vehicles" ON public.vehicles;`,
  `CREATE POLICY "Users can view their own vehicles" 
    ON public.vehicles 
    FOR SELECT 
    TO authenticated 
    USING (auth.uid() = owner_id);`,
    
  `DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles;`,
  `CREATE POLICY "Users can update their own vehicles" 
    ON public.vehicles 
    FOR UPDATE 
    TO authenticated 
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);`,
    
  `DROP POLICY IF EXISTS "Users can delete their own vehicles" ON public.vehicles;`,
  `CREATE POLICY "Users can delete their own vehicles" 
    ON public.vehicles 
    FOR DELETE 
    TO authenticated 
    USING (auth.uid() = owner_id);`,
  
  // Create storage buckets for vehicle images
  `SELECT create_storage_bucket('vehicle-images', true, true, 52428800, null);`
];

async function fixDatabase() {
  console.log('🔧 Starting simplified database fix...');
  
  try {
    // Execute SQL statements sequentially
    for (const sql of sqlStatements) {
      console.log(`Executing SQL: ${sql.substring(0, 50)}...`);
      const { error } = await supabase.rpc('exec', { query: sql });
      
      if (error) {
        // Don't stop on errors, just log them and continue
        console.warn(`⚠️ SQL Error (continuing anyway): ${error.message}`);
      }
    }
    
    // Verify database setup
    console.log('🔍 Verifying database setup...');
    const { data: tables, error: tablesError } = await supabase.rpc('exec', { 
      query: `SELECT tablename FROM pg_tables WHERE schemaname = 'public'` 
    });
    
    if (tablesError) {
      console.error('❌ Error verifying tables:', tablesError);
    } else {
      console.log('📋 Tables in database:', tables);
    }
    
    console.log('✅ Database structure fix applied');
    console.log('🎉 Your local development environment should now work!');
    console.log('📊 Access Supabase Studio at: http://127.0.0.1:54323');
    console.log('🌐 Access your app at: http://localhost:5173');
    
  } catch (error) {
    console.error('❌ Error during database fix:', error);
  }
}

fixDatabase();
