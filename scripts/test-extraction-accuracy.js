#!/usr/bin/env node

/**
 * Test Extraction Accuracy
 * Side-by-side comparison of source vs profile data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function testSingleVehicle() {
  console.log('🔍 Testing Single Vehicle Accuracy...\n');

  // Test the BMW M635CSI we know about
  const testUrl = 'https://bringatrailer.com/listing/1985-bmw-m635csi-60/';

  try {
    const { data: result, error } = await supabase.functions.invoke('audit-extraction-accuracy', {
      body: {
        audit_type: 'single_vehicle',
        source_url: testUrl
      }
    });

    if (error) {
      console.error('❌ Audit failed:', error);
      return;
    }

    if (result.success) {
      const vehicle = result.vehicle;
      const accuracy = result.accuracy_result;

      console.log('🚗 VEHICLE UNDER TEST');
      console.log('='.repeat(50));
      console.log(`Identity: ${vehicle.identity}`);
      console.log(`Source: ${vehicle.source_url}`);
      console.log(`Overall Accuracy: ${(accuracy.overall_accuracy * 100).toFixed(1)}%`);

      console.log('\n📊 FIELD-BY-FIELD COMPARISON');
      console.log('='.repeat(50));
      console.log(`🏷️  Identity: ${accuracy.identity_match ? '✅' : '❌'}`);
      console.log(`🆔 VIN: ${accuracy.vin_match === true ? '✅' : accuracy.vin_match === false ? '❌' : '➖'}`);
      console.log(`⚙️  Engine: ${accuracy.engine_match === true ? '✅' : accuracy.engine_match === false ? '❌' : '➖'}`);
      console.log(`🔧 Transmission: ${accuracy.transmission_match === true ? '✅' : accuracy.transmission_match === false ? '❌' : '➖'}`);
      console.log(`📏 Mileage: ${accuracy.mileage_match === true ? '✅' : accuracy.mileage_match === false ? '❌' : '➖'}`);
      console.log(`💰 Price: ${accuracy.price_match === true ? '✅' : accuracy.price_match === false ? '❌' : '➖'}`);
      console.log(`📝 Description: ${(accuracy.description_accuracy * 100).toFixed(1)}%`);

      if (accuracy.discrepancies.length > 0) {
        console.log('\n⚠️  DISCREPANCIES FOUND');
        console.log('-'.repeat(30));
        accuracy.discrepancies.forEach(discrepancy => {
          const emoji = discrepancy.includes('CRITICAL') ? '🚨' : '⚠️';
          console.log(`${emoji} ${discrepancy}`);
        });
      } else {
        console.log('\n✅ No discrepancies found - extraction is accurate!');
      }

      console.log('\n🔍 SIDE-BY-SIDE DATA COMPARISON');
      console.log('='.repeat(70));
      console.log(`${'Field'.padEnd(15)} | ${'Source Data'.padEnd(25)} | ${'Profile Data'.padEnd(25)}`);
      console.log('-'.repeat(70));

      const fields = ['vin', 'engine', 'transmission', 'mileage', 'asking_price'];
      fields.forEach(field => {
        const sourceValue = accuracy.source_data[field] || 'null';
        const profileValue = accuracy.profile_data[field] || 'null';
        console.log(`${field.padEnd(15)} | ${String(sourceValue).substring(0, 24).padEnd(25)} | ${String(profileValue).substring(0, 24).padEnd(25)}`);
      });

    } else {
      console.error('❌ Audit failed:', result.error);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

async function testBatchAccuracy() {
  console.log('\n🔍 Testing Batch Accuracy on BaT vehicles...\n');

  try {
    const { data: result, error } = await supabase.functions.invoke('audit-extraction-accuracy', {
      body: {
        audit_type: 'batch_sample',
        source_filter: 'bat',
        sample_size: 5  // Start with small sample
      }
    });

    if (error) {
      console.error('❌ Batch audit failed:', error);
      return;
    }

    if (result.success) {
      const summary = result.batch_summary;

      console.log('📊 BATCH ACCURACY SUMMARY');
      console.log('='.repeat(50));
      console.log(`Total Audited: ${summary.total_audited}`);
      console.log(`Average Accuracy: ${(summary.average_accuracy * 100).toFixed(1)}%`);
      console.log(`High Accuracy Rate: ${(summary.high_accuracy_rate * 100).toFixed(1)}% (${summary.high_accuracy_count}/${summary.total_audited})`);
      console.log(`Major Issues Found: ${summary.total_major_issues}`);

      console.log('\n🚗 INDIVIDUAL VEHICLE RESULTS');
      console.log('-'.repeat(60));
      result.individual_results.forEach((vehicle, i) => {
        const accuracy = vehicle.accuracy || 0;
        const status = accuracy > 0.8 ? '✅' : accuracy > 0.5 ? '⚠️' : '❌';
        console.log(`${i + 1}. ${status} ${vehicle.identity} - ${(accuracy * 100).toFixed(1)}%`);
        if (vehicle.major_issues > 0) {
          console.log(`   🚨 ${vehicle.major_issues} major issues found`);
        }
        if (vehicle.error) {
          console.log(`   ❌ Error: ${vehicle.error}`);
        }
      });

      if (result.recommendations && result.recommendations.length > 0) {
        console.log('\n💡 RECOMMENDATIONS');
        console.log('-'.repeat(30));
        result.recommendations.forEach(rec => {
          const emoji = rec.includes('CRITICAL') ? '🚨' : '💡';
          console.log(`${emoji} ${rec}`);
        });
      }

    } else {
      console.error('❌ Batch audit failed:', result.error);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

async function main() {
  console.log('🧪 EXTRACTION ACCURACY TESTING');
  console.log('='.repeat(70));

  await testSingleVehicle();
  await testBatchAccuracy();

  console.log('\n✅ Accuracy testing complete!');
  console.log('\n💡 This is the true test - comparing source vs profile data side-by-side.');
  console.log('   High accuracy here means your extractions are working correctly.');
  console.log('   Use this regularly to catch when source sites change their structure.');
}

main().catch(console.error);