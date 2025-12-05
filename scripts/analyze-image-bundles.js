// Analyze image bundles for a vehicle
// Groups images by date+device and analyzes them together for context

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeBundles(vehicleId, minImages = 3) {
  console.log(`🔍 Analyzing image bundles for vehicle: ${vehicleId}\n`);

  // Get vehicle info
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('year, make, model')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError);
    return;
  }

  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}\n`);

  // Get bundles using the function
  const { data: bundles, error: bundlesError } = await supabase
    .rpc('get_image_bundles_for_vehicle', {
      p_vehicle_id: vehicleId,
      p_min_images: minImages
    });

  if (bundlesError) {
    console.error('❌ Error fetching bundles:', bundlesError);
    return;
  }

  if (!bundles || bundles.length === 0) {
    console.log('No bundles found');
    return;
  }

  console.log(`Found ${bundles.length} bundles\n`);

  // Check each bundle for timeline fit
  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i];
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Bundle ${i + 1}/${bundles.length}:`);
    console.log(`  Date: ${bundle.bundle_date}`);
    console.log(`  Images: ${bundle.image_count}`);
    console.log(`  Device: ${bundle.device_fingerprint || 'Unknown'}`);
    console.log(`  Duration: ${Math.round(bundle.duration_minutes)} minutes`);
    console.log(`  Time: ${new Date(bundle.session_start).toLocaleTimeString()} - ${new Date(bundle.session_end).toLocaleTimeString()}`);

    // Check if bundle fits timeline
    const { data: timelineCheck } = await supabase
      .rpc('check_bundle_fits_timeline', {
        p_vehicle_id: vehicleId,
        p_bundle_date: bundle.bundle_date,
        p_device_fingerprint: bundle.device_fingerprint || 'Unknown-Unknown-Unknown-Unknown'
      });

    if (timelineCheck) {
      if (!timelineCheck.fits_timeline) {
        console.log(`  ⚠️  TIMELINE CONCERN: ${timelineCheck.concerns?.join(', ')}`);
      } else {
        console.log(`  ✅ Fits timeline`);
      }
      if (timelineCheck.nearby_events && timelineCheck.nearby_events.length > 0) {
        console.log(`  📅 Nearby events: ${timelineCheck.nearby_events.length}`);
      }
    }

    // Check if bundle already has analysis
    const { data: existingEvent } = await supabase
      .from('timeline_events')
      .select('id, title, ai_confidence_score')
      .eq('vehicle_id', vehicleId)
      .eq('event_date', bundle.bundle_date)
      .maybeSingle();

    if (existingEvent) {
      console.log(`  📋 Existing event: ${existingEvent.title} (confidence: ${existingEvent.ai_confidence_score || 'N/A'})`);
    } else {
      console.log(`  ⏳ No analysis yet - ready for bundle analysis`);
    }

    console.log('');
  }

  // Show summary
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`SUMMARY:`);
  console.log(`  Total bundles: ${bundles.length}`);
  console.log(`  Total images: ${bundles.reduce((sum, b) => sum + parseInt(b.image_count), 0)}`);
  console.log(`  Bundles without analysis: ${bundles.filter(b => !b.existing_event).length}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  return bundles;
}

async function analyzeBundle(vehicleId, bundleDate, deviceFingerprint, organizationId) {
  console.log(`🔍 Analyzing bundle: ${bundleDate} (${deviceFingerprint})\n`);

  // Get bundle context
  const { data: context, error: contextError } = await supabase
    .rpc('get_bundle_context', {
      p_vehicle_id: vehicleId,
      p_bundle_date: bundleDate,
      p_device_fingerprint: deviceFingerprint
    });

  if (contextError || !context) {
    console.error('❌ Error getting bundle context:', contextError);
    return;
  }

  console.log(`Bundle context:`);
  console.log(`  Vehicle: ${context.vehicle.year} ${context.vehicle.make} ${context.vehicle.model}`);
  console.log(`  Images: ${context.bundle.image_count}`);
  console.log(`  Image IDs: ${context.bundle.image_ids.length}\n`);

  // Call generate-work-logs with bundle
  console.log(`Calling generate-work-logs function...\n`);

  const { data, error } = await supabase.functions.invoke('generate-work-logs', {
    body: {
      vehicleId: vehicleId,
      organizationId: organizationId,
      imageIds: context.bundle.image_ids.slice(0, 20), // Limit to 20 images for now
      eventDate: bundleDate
    }
  });

  if (error) {
    console.error('❌ Error analyzing bundle:', error);
    return;
  }

  if (data.success) {
    console.log(`✅ Bundle analyzed successfully!`);
    console.log(`  Event ID: ${data.eventId}`);
    console.log(`  Parts: ${data.partsCount}`);
    console.log(`  Labor tasks: ${data.laborTasksCount}`);
  } else {
    console.error('❌ Analysis failed:', data.error);
  }
}

// Get args
const command = process.argv[2];
const vehicleId = process.argv[3];

if (!command || !vehicleId) {
  console.error('Usage:');
  console.error('  node analyze-image-bundles.js list <vehicle_id> [min_images]');
  console.error('  node analyze-image-bundles.js analyze <vehicle_id> <bundle_date> <device_fingerprint> <organization_id>');
  console.error('');
  console.error('Examples:');
  console.error('  node analyze-image-bundles.js list eea40748-cdc1-4ae9-ade1-4431d14a7726');
  console.error('  node analyze-image-bundles.js analyze eea40748-cdc1-4ae9-ade1-4431d14a7726 2025-11-04 "Unknown-Unknown-Unknown-Unknown" 1f76d43c-4dd6-4ee9-99df-6c46fd284654');
  process.exit(1);
}

if (command === 'list') {
  const minImages = parseInt(process.argv[4]) || 3;
  analyzeBundles(vehicleId, minImages).catch(console.error);
} else if (command === 'analyze') {
  const bundleDate = process.argv[4];
  const deviceFingerprint = process.argv[5];
  const organizationId = process.argv[6];

  if (!bundleDate || !deviceFingerprint || !organizationId) {
    console.error('Missing required arguments for analyze command');
    process.exit(1);
  }

  analyzeBundle(vehicleId, bundleDate, deviceFingerprint, organizationId).catch(console.error);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

