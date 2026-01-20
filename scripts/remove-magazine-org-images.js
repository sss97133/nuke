#!/usr/bin/env node

/**
 * Remove Magazine/News Publication Images from Organization Images
 * 
 * Removes images from organization_images that are magazine/news publication
 * logos (e.g., Vanity Fair) which are not appropriate for organization hero images.
 */

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function isMagazineImageUrl(url) {
  if (!url) return false;

  const urlLower = String(url || '').toLowerCase();

  // Magazine/news publication patterns
  const magazinePatterns = [
    'vanityfair',
    'vanity-fair',
    'vanity_fair',
    'time.com',
    'forbes.com',
    'wsj.com',
    'wallstreetjournal',
    'nytimes.com',
    'nytimes',
    'theatlantic.com',
    'theatlantic',
    'newyorker.com',
    'newyorker',
    'washingtonpost.com',
    'washingtonpost',
    'usatoday.com',
    'usatoday',
    'people.com',
    'people.com',
    'vogue.com',
    'vogue',
    'esquire.com',
    'esquire',
    'gq.com',
    'gq',
  ];

  // Check for magazine patterns
  for (const pattern of magazinePatterns) {
    if (urlLower.includes(pattern)) return true;
  }

  return false;
}

async function findProblematicImages() {
  console.log('🔍 Finding problematic magazine/news images...\n');

  const { data: images, error } = await supabase
    .from('organization_images')
    .select(`
      id,
      organization_id,
      image_url,
      large_url,
      medium_url,
      thumbnail_url,
      is_primary,
      category,
      created_at,
      businesses!inner(id, business_name)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching images:', error);
    return [];
  }

  const problematic = (images || []).filter(img => {
    return isMagazineImageUrl(img.image_url) ||
           isMagazineImageUrl(img.large_url) ||
           isMagazineImageUrl(img.medium_url) ||
           isMagazineImageUrl(img.thumbnail_url);
  });

  return problematic;
}

async function deleteImage(image) {
  try {
    console.log(`\n🗑️  Deleting image ${image.id}`);
    console.log(`   URL: ${image.image_url}`);
    console.log(`   Organization: ${image.businesses?.business_name || 'Unknown'} (${image.organization_id})`);
    console.log(`   Primary: ${image.is_primary ? 'YES ⚠️' : 'No'}`);
    console.log(`   Category: ${image.category || 'None'}`);

    // Delete from database
    const { error: dbError } = await supabase
      .from('organization_images')
      .delete()
      .eq('id', image.id);

    if (dbError) {
      console.error(`   ❌ Database delete failed: ${dbError.message}`);
      return false;
    }

    console.log(`   ✅ Deleted from database`);

    // If this was a primary image, we should clear the organization's logo_url if it matches
    if (image.is_primary) {
      const { data: org } = await supabase
        .from('businesses')
        .select('logo_url')
        .eq('id', image.organization_id)
        .single();

      if (org && (org.logo_url === image.image_url || org.logo_url === image.large_url)) {
        const { error: updateError } = await supabase
          .from('businesses')
          .update({ logo_url: null })
          .eq('id', image.organization_id);

        if (updateError) {
          console.warn(`   ⚠️  Failed to clear organization logo_url: ${updateError.message}`);
        } else {
          console.log(`   ✅ Cleared organization logo_url`);
        }
      }
    }

    return true;
  } catch (error) {
    console.error(`   ❌ Error deleting image: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting magazine image cleanup...\n');

  const problematic = await findProblematicImages();

  if (problematic.length === 0) {
    console.log('✅ No problematic images found!');
    return;
  }

  console.log(`\n📊 Found ${problematic.length} problematic image(s):\n`);

  // Show summary
  const primaryCount = problematic.filter(img => img.is_primary).length;
  const orgs = new Set(problematic.map(img => img.organization_id));

  console.log(`   Total images: ${problematic.length}`);
  console.log(`   Primary images: ${primaryCount} ⚠️`);
  console.log(`   Affected organizations: ${orgs.size}`);

  // Group by organization
  const byOrg = {};
  problematic.forEach(img => {
    const orgId = img.organization_id;
    if (!byOrg[orgId]) {
      byOrg[orgId] = [];
    }
    byOrg[orgId].push(img);
  });

  console.log('\n📋 Images by organization:');
  for (const [orgId, images] of Object.entries(byOrg)) {
    const orgName = images[0].businesses?.business_name || 'Unknown';
    const primary = images.filter(img => img.is_primary).length;
    console.log(`   ${orgName} (${orgId}): ${images.length} image(s)${primary > 0 ? ` (${primary} primary)` : ''}`);
  }

  // Ask for confirmation
  console.log('\n⚠️  This will permanently delete these images from the database.');
  console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

  await new Promise(resolve => setTimeout(resolve, 5000));

  // Delete images
  let deleted = 0;
  let failed = 0;

  for (const image of problematic) {
    const success = await deleteImage(image);
    if (success) {
      deleted++;
    } else {
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Cleanup complete!`);
  console.log(`   Deleted: ${deleted}`);
  console.log(`   Failed: ${failed}`);
  console.log('='.repeat(60) + '\n');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
