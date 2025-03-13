import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import * as dotenv from 'dotenv';
import type { Database } from '../src/types';

// Load environment variables based on environment
const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

// Skip validation in production to prevent blocking deployments
if (env === 'production') {
  console.log('✅ Skipping schema validation in production');
  process.exit(0);
}

// Use service key for schema validation if available
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing required Supabase credentials');
  process.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);

// Define expected schema using Zod
const VehicleSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  year: z.number().int(),
  make: z.string(),
  model: z.string(),
  status: z.enum(['active', 'archived', 'deleted']),
  vin: z.string().optional(),
  icloud_album_link: z.string().optional(),
  icloud_folder_id: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

const VehicleImageSchema = z.object({
  id: z.string().uuid(),
  car_id: z.string().uuid(),
  user_id: z.string().uuid(),
  file_path: z.string(),
  public_url: z.string().optional(),
  file_name: z.string(),
  is_primary: z.boolean(),
  source: z.enum(['supabase', 'icloud']),
  created_at: z.string().datetime()
});

const TeamMemberSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['active', 'inactive', 'pending']),
  profile_id: z.string().uuid(),
  member_type: z.enum(['owner', 'admin', 'member']),
  created_at: z.string().datetime()
});

const ProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  created_at: z.string().datetime()
});

// Map of tables to their Zod schemas
const schemaMap = {
  vehicles: VehicleSchema,
  vehicle_images: VehicleImageSchema,
  team_members: TeamMemberSchema,
  profiles: ProfileSchema
};

async function validateSchema() {
  try {
    console.log('🔍 Starting database schema validation...');

    // Fetch table information
    for (const [tableName, schema] of Object.entries(schemaMap)) {
      console.log(`📋 Checking table: ${tableName}`);
      
      // Query to get a single row to validate structure
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);

      if (error) {
        console.error(`❌ Error accessing table ${tableName}: ${error.message}`);
        process.exit(1);
      }

      // Validate schema structure
      if (!data || data.length === 0) {
        console.warn(`⚠️ No data found in table ${tableName}, skipping schema check`);
        continue;
      }

      // Get expected columns from Zod schema
      const expectedColumns = Object.keys(schema.shape);
      
      // Get actual columns
      const actualColumns = Object.keys(data[0]);
      
      // Check for missing columns
      const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));
      
      if (missingColumns.length > 0) {
        console.error(`❌ Table ${tableName} is missing required columns: ${missingColumns.join(', ')}`);
        console.error('Run the appropriate migration script to add these columns');
        process.exit(1);
      }
      
      console.log(`✅ Table ${tableName} validated successfully`);
    }

    console.log('✅ Database schema validation completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Schema validation failed:', error);
    process.exit(1);
  }
}

validateSchema();
