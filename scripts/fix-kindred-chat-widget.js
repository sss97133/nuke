#!/usr/bin/env node

/**
 * Fix incorrect merge: Chat Widget → Kindred Motorworks
 *
 * The dedupe script kept "Chat Widget" instead of "Kindred Motorworks".
 * This script moves all org-linked data back to Kindred and marks
 * Chat Widget as merged/private.
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

const SOURCE_ID = 'a35bc3a2-3444-4865-b481-586917b5fce0'; // Chat Widget
const TARGET_ID = 'e068f208-e3d3-4937-ae4d-ea3f417e25cb'; // Kindred Motorworks
const TARGET_NAME = 'Kindred Motorworks';

const ORG_ID_TABLES = [
  'organization_vehicles',
  'organization_images',
  'organization_contributors',
  'organization_followers',
  'organization_services',
  'organization_website_mappings',
  'organization_offerings',
  'organization_inventory',
  'organization_analysis_queue',
  'organization_narratives',
  'organization_ownership_verifications',
  'organization_intelligence',
  'organization_ingestion_queue',
  'organization_inventory_sync_queue',
];

const BUSINESS_ID_TABLES = [
  'business_timeline_events',
  'business_user_roles',
  'business_ownership',
];

async function updateTable(table, column, sourceId, targetId) {
  try {
    const { error } = await supabase
      .from(table)
      .update({ [column]: targetId })
      .eq(column, sourceId);
    if (error) {
      console.warn(`⚠️  ${table} update failed: ${error.message}`);
    } else {
      console.log(`✅ ${table} updated`);
    }
  } catch (err) {
    console.warn(`⚠️  ${table} update failed: ${err.message || err}`);
  }
}

async function main() {
  console.log('🔧 Fixing Kindred Motorworks merge...\n');

  const { data: sourceOrg } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', SOURCE_ID)
    .maybeSingle();

  const { data: targetOrg } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', TARGET_ID)
    .maybeSingle();

  if (!sourceOrg) {
    console.error('❌ Source org not found:', SOURCE_ID);
    process.exit(1);
  }
  if (!targetOrg) {
    console.error('❌ Target org not found:', TARGET_ID);
    process.exit(1);
  }

  console.log(`Source: ${sourceOrg.business_name} (${SOURCE_ID})`);
  console.log(`Target: ${targetOrg.business_name} (${TARGET_ID})\n`);

  // Move org-linked tables
  for (const table of ORG_ID_TABLES) {
    await updateTable(table, 'organization_id', SOURCE_ID, TARGET_ID);
  }

  // Move business-linked tables
  for (const table of BUSINESS_ID_TABLES) {
    await updateTable(table, 'business_id', SOURCE_ID, TARGET_ID);
  }

  // Update target org to be canonical
  await supabase
    .from('businesses')
    .update({
      business_name: TARGET_NAME,
      is_public: true,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', TARGET_ID);

  // Mark source org as merged/private
  await supabase
    .from('businesses')
    .update({
      business_name: `${sourceOrg.business_name} (merged)`,
      is_public: false,
      status: 'merged',
      updated_at: new Date().toISOString(),
    })
    .eq('id', SOURCE_ID);

  console.log('\n✅ Kindred Motorworks merge fixed.');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
