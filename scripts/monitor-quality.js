#!/usr/bin/env node

/**
 * Monitor Data Quality Improvements
 * Checks current extraction quality during backfill process
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function monitorQuality() {
  console.log('🔍 Monitoring Data Quality Improvements...\n');

  try {
    // Call inspection function
    const { data: inspection, error } = await supabase.functions.invoke('inspect-extraction-quality', {
      body: {
        inspection_type: 'data_quality_audit',
        source_filter: 'bat',
        limit: 25
      }
    });

    if (error) {
      console.error('❌ Inspection failed:', error);
      return;
    }

    // console.log('Raw inspection result:', JSON.stringify(inspection, null, 2));

    if (inspection?.success && inspection.quality_metrics) {
      const metrics = inspection.quality_metrics;

      console.log('📊 CURRENT DATA QUALITY STATUS');
      console.log('='.repeat(50));
      console.log(`📋 Total BaT Vehicles Sampled: ${metrics.total_vehicles}`);
      console.log(`🔢 VIN Coverage: ${(metrics.vin_coverage * 100).toFixed(1)}%`);
      console.log(`⚙️  Engine Coverage: ${(metrics.engine_coverage * 100).toFixed(1)}%`);
      console.log(`🔧 Transmission Coverage: ${(metrics.transmission_coverage * 100).toFixed(1)}%`);
      console.log(`📏 Mileage Coverage: ${(metrics.mileage_coverage * 100).toFixed(1)}%`);
      console.log(`📝 Description Coverage: ${(metrics.description_coverage * 100).toFixed(1)}%`);
      console.log(`🖼️  Average Images/Vehicle: ${metrics.average_images_per_vehicle}`);
      console.log(`✅ Overall Completeness: ${(metrics.data_completeness_score * 100).toFixed(1)}%`);

      if (inspection.sample_vehicles) {
        console.log('\n🚗 SAMPLE VEHICLE ANALYSIS');
        console.log('-'.repeat(30));
        inspection.sample_vehicles.slice(0, 3).forEach((vehicle, i) => {
          console.log(`${i + 1}. ${vehicle.identity}`);
          console.log(`   VIN: ${vehicle.vin ? '✅' : '❌'} | Mileage: ${vehicle.has_mileage ? '✅' : '❌'} | Description: ${vehicle.description_length > 100 ? '✅' : '❌'}`);
          console.log(`   Source: ${vehicle.source}`);
        });
      }

      console.log('\n💡 RECOMMENDATIONS');
      console.log('-'.repeat(20));
      if (metrics.engine_coverage < 50) {
        console.log('• Continue backfill process - engine specs need improvement');
      }
      if (metrics.vin_coverage < 80) {
        console.log('• VIN coverage still improving - backfill in progress');
      }
      if (metrics.data_completeness_score > 70) {
        console.log('✅ Good progress! Quality is improving significantly');
      }

    } else {
      console.error('❌ Inspection returned no data');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

monitorQuality();