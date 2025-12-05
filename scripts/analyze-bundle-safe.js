// Safe bundle analysis script that uses Supabase edge function
// Won't fail due to local environment issues

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeBundle(vehicleId, bundleDate, deviceFingerprint, organizationId) {
  console.log(`🔍 Analyzing bundle via Supabase edge function...\n`);
  console.log(`  Vehicle: ${vehicleId}`);
  console.log(`  Date: ${bundleDate}`);
  console.log(`  Device: ${deviceFingerprint}`);
  console.log(`  Organization: ${organizationId}\n`);

  try {
    const { data, error } = await supabase.functions.invoke('analyze-bundle', {
      body: {
        vehicleId,
        bundleDate,
        deviceFingerprint,
        organizationId
      }
    });

    if (error) {
      console.error('❌ Error calling function:', error.message);
      // Try to get error details from response
      if (error.context && error.context.body) {
        try {
          const errorBody = await error.context.json();
          console.error('  Error details:', JSON.stringify(errorBody, null, 2));
        } catch (e) {
          const errorText = await error.context.text();
          console.error('  Error response:', errorText);
        }
      }
      return;
    }

    if (data && data.success) {
      console.log('✅ Bundle analyzed successfully!');
      console.log(`  Event ID: ${data.eventId}`);
      console.log(`  Images in bundle: ${data.bundle.imageCount}`);
      console.log(`  Images analyzed: ${data.bundle.imagesAnalyzed}`);
      console.log(`  Parts found: ${data.result.partsCount}`);
      console.log(`  Labor tasks: ${data.result.laborTasksCount}`);
    } else {
      console.error('❌ Analysis failed:', data?.error || 'Unknown error');
      if (data?.details) {
        console.error('  Details:', data.details);
      }
      console.error('  Full response:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  }
}

// Get args
const vehicleId = process.argv[2];
const bundleDate = process.argv[3];
const deviceFingerprint = process.argv[4];
const organizationId = process.argv[5];

if (!vehicleId || !bundleDate || !deviceFingerprint || !organizationId) {
  console.error('Usage:');
  console.error('  node scripts/analyze-bundle-safe.js <vehicle_id> <bundle_date> <device_fingerprint> <organization_id>');
  console.error('');
  console.error('Example:');
  console.error('  node scripts/analyze-bundle-safe.js \\');
  console.error('    eea40748-cdc1-4ae9-ade1-4431d14a7726 \\');
  console.error('    2025-11-01 \\');
  console.error('    "Unknown-Unknown-Unknown-Unknown" \\');
  console.error('    1f76d43c-4dd6-4ee9-99df-6c46fd284654');
  process.exit(1);
}

analyzeBundle(vehicleId, bundleDate, deviceFingerprint, organizationId).catch(console.error);

