// Direct bundle analysis - bypasses edge function issues
// Calls generate-work-logs directly with bundle data

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeBundleDirect(vehicleId, bundleDate, deviceFingerprint, organizationId) {
  console.log(`🔍 Analyzing bundle directly...\n`);
  console.log(`  Vehicle: ${vehicleId}`);
  console.log(`  Date: ${bundleDate}`);
  console.log(`  Device: ${deviceFingerprint}`);
  console.log(`  Organization: ${organizationId}\n`);

  try {
    // 1. Get bundle context from database
    const { data: context, error: contextError } = await supabase
      .rpc('get_bundle_context', {
        p_vehicle_id: vehicleId,
        p_bundle_date: bundleDate,
        p_device_fingerprint: deviceFingerprint
      });

    if (contextError) {
      console.error('❌ Error getting bundle context:', contextError);
      return;
    }

    if (!context || !context.bundle || !context.bundle.image_ids || context.bundle.image_ids.length === 0) {
      console.error('❌ No images found in bundle');
      return;
    }

    console.log(`✅ Found ${context.bundle.image_ids.length} images in bundle`);
    
    // 2. Limit to 10 images
    const imageIds = context.bundle.image_ids.slice(0, 10);
    console.log(`📸 Analyzing ${imageIds.length} images...\n`);

    // 3. Call generate-work-logs directly
    const { data, error } = await supabase.functions.invoke('generate-work-logs', {
      body: {
        vehicleId,
        organizationId,
        imageIds,
        eventDate: bundleDate
      }
    });

    if (error) {
      console.error('❌ Error calling generate-work-logs:', error.message);
      if (error.context) {
        try {
          const errorBody = await error.context.json();
          console.error('  Details:', JSON.stringify(errorBody, null, 2));
        } catch (e) {
          const errorText = await error.context.text();
          console.error('  Response:', errorText);
        }
      }
      return;
    }

    if (data && data.success) {
      console.log('✅ Bundle analyzed successfully!');
      console.log(`  Event ID: ${data.eventId}`);
      console.log(`  Parts found: ${data.partsCount || 0}`);
      console.log(`  Labor tasks: ${data.laborTasksCount || 0}`);
      console.log(`\n🎉 Receipt data populated! Check the receipt UI.`);
    } else {
      console.error('❌ Analysis failed:', data?.error || 'Unknown error');
      if (data) {
        console.error('  Full response:', JSON.stringify(data, null, 2));
      }
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    console.error(error.stack);
  }
}

// Get args
const vehicleId = process.argv[2];
const bundleDate = process.argv[3];
const deviceFingerprint = process.argv[4];
const organizationId = process.argv[5];

if (!vehicleId || !bundleDate || !deviceFingerprint || !organizationId) {
  console.error('Usage:');
  console.error('  node scripts/analyze-bundle-direct.js <vehicle_id> <bundle_date> <device_fingerprint> <organization_id>');
  console.error('');
  console.error('Example:');
  console.error('  node scripts/analyze-bundle-direct.js \\');
  console.error('    eea40748-cdc1-4ae9-ade1-4431d14a7726 \\');
  console.error('    2025-11-01 \\');
  console.error('    "Unknown-Unknown-Unknown-Unknown" \\');
  console.error('    1f76d43c-4dd6-4ee9-99df-6c46fd284654');
  process.exit(1);
}

analyzeBundleDirect(vehicleId, bundleDate, deviceFingerprint, organizationId).catch(console.error);

