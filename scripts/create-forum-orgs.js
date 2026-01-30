#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('Creating org profiles for all forums...\n');

  const { data: forums } = await supabase
    .from('forum_sources')
    .select('id, slug, name, base_url, platform_type, vehicle_categories');

  let created = 0;
  let existed = 0;
  let errors = 0;

  for (const forum of forums || []) {
    const orgSlug = `forum-${forum.slug}`;

    // Check if org exists
    const { data: existingOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', orgSlug)
      .single();

    if (existingOrg) {
      existed++;
      continue;
    }

    // Create org profile - use 'collection' type since 'forum' isn't in constraint
    // Mark as forum via specialties and description
    const { error } = await supabase
      .from('organizations')
      .insert({
        slug: orgSlug,
        name: forum.name,
        type: 'collection',  // Closest allowed type
        website: forum.base_url,
        description: `[FORUM] Automotive enthusiast forum${forum.platform_type ? ` - ${forum.platform_type} platform` : ''}`,
        specialties: ['forum', ...(forum.vehicle_categories || [])],
        source_url: forum.base_url,
        discovered_via: 'forum_registry',
        is_active: true,
      });

    if (error) {
      console.log(`  ❌ ${forum.slug}: ${error.message}`);
      errors++;
    } else {
      console.log(`  ✅ ${forum.slug}`);
      created++;
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Created: ${created}`);
  console.log(`Existed: ${existed}`);
  console.log(`Errors:  ${errors}`);

  // Get totals
  const { count: totalOrgs } = await supabase
    .from('organizations')
    .select('*', { count: 'exact', head: true });

  const { count: forumOrgs } = await supabase
    .from('organizations')
    .select('*', { count: 'exact', head: true })
    .contains('specialties', ['forum']);

  console.log('\n' + '═'.repeat(50));
  console.log('📦 ORGANIZATION INVENTORY');
  console.log('═'.repeat(50));
  console.log(`  Forum Orgs:    ${forumOrgs}`);
  console.log(`  Total Orgs:    ${totalOrgs}`);
}

main();
