#!/usr/bin/env node
/**
 * Apply shipping_tasks migration to remote database
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyShippingMigration() {
  console.log('Creating shipping_tasks table...');
  
  try {
    // Create the table
    const { error: tableError } = await supabase.rpc('query', {
      query: `
        CREATE TABLE IF NOT EXISTS shipping_tasks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          task_type TEXT NOT NULL CHECK (task_type IN ('truck_transport', 'boat_container', 'customs_clearance', 'unloading', 'final_delivery', 'tracking_installation', 'documentation')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
          title TEXT NOT NULL,
          description TEXT,
          responsible_party TEXT,
          estimated_cost DECIMAL(10,2),
          actual_cost DECIMAL(10,2),
          currency TEXT DEFAULT 'USD',
          start_date TIMESTAMPTZ,
          completion_date TIMESTAMPTZ,
          due_date TIMESTAMPTZ,
          priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
          notes TEXT,
          metadata JSONB DEFAULT '{}',
          created_by UUID REFERENCES auth.users(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `
    });
    
    if (tableError) {
      console.error('Error creating table:', tableError);
      return;
    }
    
    console.log('Table created successfully!');
    
    // Add indexes
    console.log('Creating indexes...');
    await supabase.rpc('query', {
      query: 'CREATE INDEX IF NOT EXISTS idx_shipping_tasks_vehicle_id ON shipping_tasks(vehicle_id)'
    });
    
    await supabase.rpc('query', {
      query: 'CREATE INDEX IF NOT EXISTS idx_shipping_tasks_status ON shipping_tasks(status)'
    });
    
    console.log('Indexes created!');
    
    // Enable RLS
    console.log('Enabling RLS...');
    await supabase.rpc('query', {
      query: 'ALTER TABLE shipping_tasks ENABLE ROW LEVEL SECURITY'
    });
    
    // Add RLS policies
    console.log('Creating RLS policies...');
    await supabase.rpc('query', {
      query: `
        CREATE POLICY "Vehicle owners can view shipping tasks" ON shipping_tasks
        FOR SELECT USING (
          vehicle_id IN (
            SELECT id FROM vehicles WHERE user_id = auth.uid()
          )
        )
      `
    });
    
    await supabase.rpc('query', {
      query: `
        CREATE POLICY "Vehicle owners can manage shipping tasks" ON shipping_tasks
        FOR ALL USING (
          vehicle_id IN (
            SELECT id FROM vehicles WHERE user_id = auth.uid()
          )
        )
      `
    });
    
    console.log('Migration completed successfully!');
    
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

applyShippingMigration();
