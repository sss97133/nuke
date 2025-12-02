#!/usr/bin/env node
/**
 * Fix KSL vehicle data with improved extraction
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixVehicle() {
  const vehicleId = 'a76c1d50-eca3-4430-9422-a00ea88725fd';
  
  console.log('Fixing vehicle:', vehicleId);
  
  // Update with corrected data
  const { error } = await supabase
    .from('vehicles')
    .update({
      model: 'pickup',
      trim: null,  // Will be detected from image (Scottsdale)
      origin_metadata: {
        series: 'K10',
        drivetrain: '4WD',
        engine_type: 'Diesel',
        year_conflict: {
          title_year: 1980,
          description_year: 1983,
          message: 'Title says 1980 but description mentions 1983 - needs verification'
        },
        data_corrections: [
          'Derived series K10 from 1/2 ton + 4WD',
          'Year conflict: title=1980, description=1983',
          'Model normalized from 1/2 ton to Pickup'
        ],
        listed_date: '2025-11-30T15:25:16.862Z',
        location: 'Glenns Ferry, ID',
        body_style: 'Truck',
        scraped_at: new Date().toISOString()
      }
    })
    .eq('id', vehicleId);
  
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Updated vehicle with corrected data');
  }
  
  // Update image dates to listing date
  const listedDate = '2025-11-30T15:25:16.862Z';
  const { error: imageError, count } = await supabase
    .from('vehicle_images')
    .update({ taken_at: listedDate })
    .eq('vehicle_id', vehicleId);
  
  if (imageError) {
    console.error('Image date error:', imageError);
  } else {
    console.log('Updated image dates to listing date (Nov 30, 2025)');
  }
}

fixVehicle().catch(console.error);

