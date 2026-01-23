/**
 * Audit C&B extraction quality - what do we have vs what's missing
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== C&B EXTRACTION QUALITY AUDIT ===\n');

  // Count total C&B vehicles
  const { count: totalCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .ilike('discovery_url', '%carsandbids%');

  console.log(`Total C&B vehicles in database: ${totalCount}\n`);

  // Get sample of 10 recent C&B vehicles with their data
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select(`
      id, year, make, model, vin, mileage, description,
      color, interior_color, engine_type, transmission,
      drivetrain, body_style, discovery_url, created_at
    `)
    .ilike('discovery_url', '%carsandbids%')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('No C&B vehicles found');
    return;
  }

  // Audit each vehicle
  let stats = {
    total: vehicles.length,
    hasVin: 0,
    hasMileage: 0,
    hasDescription: 0,
    hasExteriorColor: 0,
    hasInteriorColor: 0,
    hasEngine: 0,
    hasTransmission: 0,
    hasDrivetrain: 0,
    hasBodyStyle: 0,
    hasImages: 0,
    hasExternalListing: 0,
    hasMetadata: 0,
    hasHighlights: 0,
    hasEquipment: 0,
    hasKnownFlaws: 0,
    hasDougsTake: 0,
    hasComments: 0,
    avgImageCount: 0,
    avgCommentCount: 0,
  };

  let totalImages = 0;
  let totalComments = 0;

  console.log('--- SAMPLE VEHICLES ---\n');

  for (const v of vehicles) {
    console.log(`${v.year} ${v.make} ${v.model}`);
    console.log(`  URL: ${v.discovery_url}`);

    // Basic fields
    if (v.vin) stats.hasVin++;
    if (v.mileage) stats.hasMileage++;
    if (v.description) stats.hasDescription++;
    if (v.color) stats.hasExteriorColor++;
    if (v.interior_color) stats.hasInteriorColor++;
    if (v.engine_type) stats.hasEngine++;
    if (v.transmission) stats.hasTransmission++;
    if (v.drivetrain) stats.hasDrivetrain++;
    if (v.body_style) stats.hasBodyStyle++;

    const missing = [];
    if (!v.vin) missing.push('VIN');
    if (!v.mileage) missing.push('mileage');
    if (!v.description) missing.push('description');
    if (!v.color) missing.push('ext_color');
    if (!v.interior_color) missing.push('int_color');
    if (!v.engine_type) missing.push('engine');
    if (!v.transmission) missing.push('transmission');

    if (missing.length > 0) {
      console.log(`  ❌ Missing: ${missing.join(', ')}`);
    } else {
      console.log(`  ✅ All basic fields present`);
    }

    // Check images
    const { count: imgCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', v.id);

    const imageCount = imgCount || 0;
    totalImages += imageCount;
    if (imageCount > 0) stats.hasImages++;
    console.log(`  Images: ${imageCount}`);

    // Check external_listing
    const { data: listing } = await supabase
      .from('external_listings')
      .select('id, current_bid, metadata')
      .eq('vehicle_id', v.id)
      .eq('platform', 'carsandbids')
      .maybeSingle();

    if (listing) {
      stats.hasExternalListing++;
      const meta = listing.metadata as Record<string, any> || {};
      const metaKeys = Object.keys(meta);
      if (metaKeys.length > 0) {
        stats.hasMetadata++;
        console.log(`  Metadata: ${metaKeys.join(', ')}`);
        if (meta.highlights) stats.hasHighlights++;
        if (meta.equipment) stats.hasEquipment++;
        if (meta.known_flaws) stats.hasKnownFlaws++;
        if (meta.dougs_take) stats.hasDougsTake++;
      } else {
        console.log(`  Metadata: EMPTY`);
      }
    } else {
      console.log(`  ❌ No external_listing record`);
    }

    // Check comments
    const { count: commentCount } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', v.id);

    const comments = commentCount || 0;
    totalComments += comments;
    if (comments > 0) stats.hasComments++;
    console.log(`  Comments: ${comments}`);

    console.log('');
  }

  stats.avgImageCount = totalImages / stats.total;
  stats.avgCommentCount = totalComments / stats.total;

  console.log('\n=== SUMMARY (sample of 10) ===\n');
  console.log('Basic Fields:');
  console.log(`  VIN:           ${stats.hasVin}/${stats.total} (${Math.round(stats.hasVin/stats.total*100)}%)`);
  console.log(`  Mileage:       ${stats.hasMileage}/${stats.total} (${Math.round(stats.hasMileage/stats.total*100)}%)`);
  console.log(`  Description:   ${stats.hasDescription}/${stats.total} (${Math.round(stats.hasDescription/stats.total*100)}%)`);
  console.log(`  Ext Color:     ${stats.hasExteriorColor}/${stats.total} (${Math.round(stats.hasExteriorColor/stats.total*100)}%)`);
  console.log(`  Int Color:     ${stats.hasInteriorColor}/${stats.total} (${Math.round(stats.hasInteriorColor/stats.total*100)}%)`);
  console.log(`  Engine:        ${stats.hasEngine}/${stats.total} (${Math.round(stats.hasEngine/stats.total*100)}%)`);
  console.log(`  Transmission:  ${stats.hasTransmission}/${stats.total} (${Math.round(stats.hasTransmission/stats.total*100)}%)`);

  console.log('\nRich Content:');
  console.log(`  Has Images:    ${stats.hasImages}/${stats.total} (avg: ${stats.avgImageCount.toFixed(1)})`);
  console.log(`  Has Comments:  ${stats.hasComments}/${stats.total} (avg: ${stats.avgCommentCount.toFixed(1)})`);
  console.log(`  External List: ${stats.hasExternalListing}/${stats.total}`);

  console.log('\nContent Sections (in metadata):');
  console.log(`  Highlights:    ${stats.hasHighlights}/${stats.total}`);
  console.log(`  Equipment:     ${stats.hasEquipment}/${stats.total}`);
  console.log(`  Known Flaws:   ${stats.hasKnownFlaws}/${stats.total}`);
  console.log(`  Doug's Take:   ${stats.hasDougsTake}/${stats.total}`);
}

main();
