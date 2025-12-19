#!/usr/bin/env node

/**
 * Apply vehicle_images migration directly
 * Attempts to use Supabase Management API or provides instructions
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

async function applyMigration() {
  console.log('🚀 Applying vehicle_images table migration via Supabase...\n');

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
    console.error('   Please set it in .env or .env.local\n');
    process.exit(1);
  }

  // Read the migration file
  const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251219000001_ensure_vehicle_images_table.sql');
  const migrationSQL = readFileSync(migrationPath, 'utf-8');

  console.log('📄 Migration file loaded\n');

  // Try to execute via Supabase Management API
  // The Management API requires a different endpoint and authentication
  try {
    // Try using the Supabase Management API
    // Note: This requires the Management API access token, not the service role key
    const managementApiUrl = SUPABASE_URL.replace('.supabase.co', '.supabase.com');
    
    console.log('🔄 Attempting to apply via Supabase Management API...\n');
    
    // The Management API endpoint for executing SQL
    // Format: https://api.supabase.com/v1/projects/{project_ref}/database/query
    const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
    
    if (projectRef) {
      const managementEndpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
      
      // Try with service role key first (may not work for Management API)
      const response = await fetch(managementEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: migrationSQL
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Migration applied successfully via Management API!');
        console.log('Result:', result);
        return;
      } else {
        const errorText = await response.text();
        console.log('⚠️  Management API request failed (this is expected if using service role key)');
        console.log(`   Status: ${response.status}`);
        console.log(`   Error: ${errorText.substring(0, 200)}\n`);
      }
    }
  } catch (error) {
    console.log('⚠️  Management API not available or requires different authentication\n');
  }

  // Fallback: Provide instructions
  console.log('📋 To apply this migration, use one of these methods:\n');
  
  console.log('Option 1: Supabase Dashboard (Recommended)');
  console.log('   1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new');
  console.log('   2. Copy the migration SQL below');
  console.log('   3. Paste and click "Run"\n');
  
  console.log('Option 2: Supabase CLI');
  console.log('   supabase db push\n');
  
  console.log('Option 3: Direct psql (if you have DB password)');
  console.log('   psql "postgresql://postgres.qkgaybvrernstplzjaam:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres" \\');
  console.log('     -f supabase/migrations/20251219000001_ensure_vehicle_images_table.sql\n');
  
  console.log('📄 Migration SQL:');
  console.log('─'.repeat(80));
  console.log(migrationSQL);
  console.log('─'.repeat(80));
}

applyMigration().catch(console.error);

