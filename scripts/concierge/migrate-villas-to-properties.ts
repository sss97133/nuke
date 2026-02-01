#!/usr/bin/env npx tsx
/**
 * Migrate imported villas from businesses table to properties table
 */

import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Migrating villas from businesses to properties...\n');

  // Get villa type ID
  const { data: villaType } = await supabase
    .from('property_types')
    .select('id')
    .eq('slug', 'villa')
    .single();

  if (!villaType) {
    console.error('Villa type not found');
    process.exit(1);
  }

  // Get all villa businesses
  const { data: villas, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('business_type', 'villa_rental')
    .eq('metadata->>project', 'lofficiel-concierge');

  if (error) {
    console.error('Error fetching villas:', error);
    process.exit(1);
  }

  console.log(`Found ${villas?.length || 0} villas to migrate\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const villa of villas || []) {
    const meta = villa.metadata || {};

    // Check if already migrated
    const { data: existing } = await supabase
      .from('properties')
      .select('id')
      .eq('external_id', meta.sibarth_id?.toString() || villa.id)
      .single();

    if (existing) {
      skipped++;
      continue;
    }

    // Determine owner org (the rental agency)
    let ownerOrgId: string | null = null;
    if (villa.discovered_via) {
      const { data: agency } = await supabase
        .from('businesses')
        .select('id')
        .eq('business_type', 'concierge_service')
        .ilike('website', `%${villa.discovered_via}%`)
        .single();

      ownerOrgId = agency?.id || null;
    }

    // Build property record
    const property = {
      name: (villa.business_name || '').replace(/^Villa\s+/i, ''),
      slug: (meta.villa_slug || villa.business_name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      description: meta.tagline || null,
      tagline: meta.tagline || null,

      property_type_id: villaType.id,
      property_type: 'villa',

      owner_org_id: ownerOrgId,

      city: villa.city,
      region: villa.city,
      country: villa.country || 'BL',
      latitude: villa.latitude,
      longitude: villa.longitude,

      specs: {
        bedrooms: meta.bedrooms_max || meta.bedrooms_min || null,
        bedrooms_min: meta.bedrooms_min,
        bedrooms_max: meta.bedrooms_max,
      },

      base_price: meta.price_low || null,
      price_currency: meta.price_currency || 'USD',
      price_period: meta.price_period === 'sale' ? 'sale' : 'week',

      listing_type: meta.listing_type || 'rental',
      sale_price: meta.listing_type === 'sale' ? meta.price_low : null,

      external_id: meta.sibarth_id?.toString() || villa.id,
      source_url: villa.source_url || villa.website,
      discovered_via: villa.discovered_via,

      search_keywords: villa.search_keywords || [],

      metadata: {
        project: 'lofficiel-concierge',
        migrated_from_business_id: villa.id,
        original_metadata: meta,
      },
    };

    // Insert property
    const { data: newProp, error: insertError } = await supabase
      .from('properties')
      .insert(property)
      .select()
      .single();

    if (insertError) {
      console.error(`Error migrating ${villa.business_name}: ${insertError.message}`);
      errors++;
      continue;
    }

    // Add images if available
    if (meta.images && Array.isArray(meta.images) && newProp) {
      const images = meta.images.map((url: string, i: number) => ({
        property_id: newProp.id,
        url,
        sort_order: i,
        is_primary: i === 0,
        category: i === 0 ? 'exterior' : 'interior',
      }));

      await supabase.from('property_images').insert(images);
    }

    migrated++;
  }

  console.log('Migration complete!');
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped (already exists): ${skipped}`);
  console.log(`  Errors: ${errors}`);

  // Verify
  const { count } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('property_type', 'villa');

  console.log(`\nTotal villas in properties table: ${count}`);
}

main().catch(console.error);
