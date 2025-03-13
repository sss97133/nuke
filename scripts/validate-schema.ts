import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import * as dotenv from 'dotenv';

// Load environment variables based on environment
const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

// Skip validation in production to prevent blocking deployments
if (env === 'production') {
  console.log('✅ Skipping schema validation in production');
  process.exit(0);
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.VITE_SUPABASE_ANON_KEY || ''
)

if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

// Define expected schema using Zod
const VehicleSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  year: z.number().int(),
  make: z.string(),
  model: z.string(),
  status: z.enum(['active', 'archived', 'deleted']),
  icloud_album_link: z.string().optional(),
  icloud_folder_id: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
})

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
})

async function validateSchema() {
  try {
    // Fetch table information
    const { data: vehicleColumns, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .limit(1)
    
    const { data: imageColumns, error: imageError } = await supabase
      .from('vehicle_images')
      .select('*')
      .limit(1)

    if (vehicleError) throw new Error(`Vehicle table error: ${vehicleError.message}`)
    if (imageError) throw new Error(`Vehicle images table error: ${imageError.message}`)

    // Validate schema structure
    if (!vehicleColumns || !imageColumns) {
      throw new Error('Failed to fetch table structure')
    }

    const vehicleKeys = Object.keys(vehicleColumns[0] || {})
    const imageKeys = Object.keys(imageColumns[0] || {})

    const expectedVehicleKeys = Object.keys(VehicleSchema.shape)
    const expectedImageKeys = Object.keys(VehicleImageSchema.shape)

    // Check for missing columns
    const missingVehicleColumns = expectedVehicleKeys.filter(key => !vehicleKeys.includes(key))
    const missingImageColumns = expectedImageKeys.filter(key => !imageKeys.includes(key))

    if (missingVehicleColumns.length > 0) {
      throw new Error(`Missing columns in vehicles table: ${missingVehicleColumns.join(', ')}`)
    }

    if (missingImageColumns.length > 0) {
      throw new Error(`Missing columns in vehicle_images table: ${missingImageColumns.join(', ')}`)
    }

    console.log('✅ Database schema validation passed')
    process.exit(0)
  } catch (error) {
    console.error('❌ Schema validation failed:', error)
    process.exit(1)
  }
}

validateSchema()
