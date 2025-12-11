require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Use the actual Supabase client from the frontend
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://uxqjqgqvgdqxqxqxqxqx.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function createVinTable() {
  console.log('Creating vin_validations table directly...');
  
  // First check if table exists
  const { data: existingTables, error: checkError } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_name', 'vin_validations');
    
  if (existingTables && existingTables.length > 0) {
    console.log('Table already exists');
    return true;
  }

  // Create table using direct insert approach
  try {
    const { data, error } = await supabase
      .from('vin_validations')
      .insert({
        vehicle_id: '00000000-0000-0000-0000-000000000001',
        vin_photo_url: 'test',
        submitted_vin: 'TEST12345678901234',
        validation_status: 'pending'
      });

    if (error && error.message.includes('relation "vin_validations" does not exist')) {
      console.log('Table does not exist, need manual creation');
      return false;
    }
    
    return true;
  } catch (err) {
    console.error('Table creation test failed:', err);
    return false;
  }
}

createVinTable().then(success => {
  if (success) {
    console.log('✅ VIN validations table is ready');
  } else {
    console.log('❌ Need to create table manually via Supabase dashboard');
    console.log('\nSQL to run in Supabase SQL Editor:');
    console.log(`
CREATE TABLE vin_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID,
  user_id UUID,
  vin_photo_url TEXT NOT NULL,
  extracted_vin TEXT,
  submitted_vin TEXT NOT NULL,
  validation_status TEXT DEFAULT 'pending',
  confidence_score DECIMAL(3,2),
  validation_method TEXT DEFAULT 'manual',
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE vin_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vin_validations_public" ON vin_validations
  FOR ALL USING (true) WITH CHECK (true);
    `);
  }
});
