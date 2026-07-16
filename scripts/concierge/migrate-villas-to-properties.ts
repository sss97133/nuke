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
  let errors = 0;

  for (const villa of villas || []) {
    const meta = villa.metadata || {};

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

    // Upsert property. Real upsert against the DB-level unique index on
    // (property_type, source_url) — re-running this script (e.g. a re-scrape)
    // now UPDATEs the existing row instead of minting a fresh UUID each time.
    // This is the fix for the 2026-01/02 runaway-duplication incident (3,090
    // dead rows across 10 villas from a broken check-then-insert pattern).
    let propId: string | null = null;

    if (!property.source_url) {
      // Without a source_url the (property_type, source_url) unique index
      // can't dedupe this row via upsert. Fall back to a manual check
      // against external_id (always populated: meta.sibarth_id or
      // villa.id) so these villas still migrate exactly once instead of
      // being silently dropped, mirroring the self-healing check-then-
      // branch pattern used in import-sibarth-villas.ts for its 23505
      // conflict handling.
      const { data: existingByExternalId, error: existingLookupError } = await supabase
        .from('properties')
        .select('id')
        .eq('property_type', 'villa')
        .eq('external_id', property.external_id)
        .maybeSingle();

      if (existingLookupError) {
        // Do NOT fall through to insert on a failed existence check — that
        // is exactly how the 2026-01/02 runaway duplication happened.
        console.error(`Error migrating ${villa.business_name}: existence check failed: ${existingLookupError.message}`);
        errors++;
        continue;
      }

      if (existingByExternalId) {
        const { error: updateError } = await supabase
          .from('properties')
          .update(property)
          .eq('id', existingByExternalId.id);
        if (updateError) {
          console.error(`Error migrating ${villa.business_name}: ${updateError.message}`);
          errors++;
          continue;
        }
        propId = existingByExternalId.id;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('properties')
          .insert(property)
          .select()
          .single();
        if (insertError) {
          console.error(`Error migrating ${villa.business_name}: ${insertError.message}`);
          errors++;
          continue;
        }
        propId = inserted?.id ?? null;
      }
    } else {
      const { data: newProp, error: upsertError } = await supabase
        .from('properties')
        .upsert(property, { onConflict: 'property_type,source_url' })
        .select()
        .single();

      if (upsertError) {
        console.error(`Error migrating ${villa.business_name}: ${upsertError.message}`);
        errors++;
        continue;
      }
      propId = newProp?.id ?? null;
    }

    // Add images if available — dedupe against what's already attached so
    // re-running this script doesn't re-stack duplicate property_images rows
    // the same way the old properties duplication happened. Applies to both
    // paths above: villas without a source_url still get their photos synced,
    // not just the source_url upsert path.
    if (meta.images && Array.isArray(meta.images) && propId) {
      const { data: existingImages } = await supabase
        .from('property_images')
        .select('url')
        .eq('property_id', propId);

      const existingUrls = new Set((existingImages || []).map((img: { url: string }) => img.url));
      const newImages = meta.images.filter((url: string) => !existingUrls.has(url));

      if (newImages.length > 0) {
        const images = newImages.map((url: string, i: number) => ({
          property_id: propId,
          url,
          sort_order: existingUrls.size + i,
          is_primary: existingUrls.size === 0 && i === 0,
          category: existingUrls.size === 0 && i === 0 ? 'exterior' : 'interior',
        }));

        await supabase.from('property_images').insert(images);
      }
    }

    migrated++;
  }

  console.log('Migration complete!');
  console.log(`  Migrated (inserted or updated): ${migrated}`);
  console.log(`  Errors: ${errors}`);

  // Verify
  const { count } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('property_type', 'villa');

  console.log(`\nTotal villas in properties table: ${count}`);
}

main().catch(console.error);
