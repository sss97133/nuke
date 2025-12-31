#!/usr/bin/env node
/**
 * Find and merge Bring a Trailer duplicate organizations
 * Aggressively searches for all BaT variations
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function normalizeWebsite(url) {
  if (!url) return null;
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .trim();
}

function normalizeName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBaTOrganization(org) {
  const name = normalizeName(org.business_name);
  const website = normalizeWebsite(org.website);
  
  // BaT website patterns
  const batWebsites = [
    'bringatrailer.com',
    'bring-a-trailer.com',
    'bat.com'
  ];
  
  if (website && batWebsites.some(bat => website.includes(bat))) {
    return true;
  }
  
  // BaT name patterns
  const batNamePatterns = [
    'bring a trailer',
    'bringatrailer',
    'bring-a-trailer',
    'bring trailer',
    'bat ',
    ' bat',
    '^bat$'
  ];
  
  if (name && batNamePatterns.some(pattern => {
    const regex = new RegExp(pattern.replace(/\^|\$/g, ''));
    return regex.test(name);
  })) {
    return true;
  }
  
  return false;
}

async function mergeOrganizations(sourceId, targetId) {
  console.log(`\n  🔄 Merging ${sourceId.substring(0, 8)}... → ${targetId.substring(0, 8)}...`);
  
  try {
    // Move vehicles
    const { error: vehicleError } = await supabase
      .from('organization_vehicles')
      .update({ organization_id: targetId })
      .eq('organization_id', sourceId);
    if (vehicleError && !vehicleError.message.includes('duplicate')) {
      console.warn(`    ⚠️  Vehicle merge warning: ${vehicleError.message}`);
    }

    // Move images
    const { error: imageError } = await supabase
      .from('organization_images')
      .update({ organization_id: targetId })
      .eq('organization_id', sourceId);
    if (imageError) {
      console.warn(`    ⚠️  Image merge warning: ${imageError.message}`);
    }

    // Move timeline events
    const { error: timelineError } = await supabase
      .from('business_timeline_events')
      .update({ business_id: targetId })
      .eq('business_id', sourceId);
    if (timelineError) {
      console.warn(`    ⚠️  Timeline merge warning: ${timelineError.message}`);
    }

    // Mark source as merged
    const { data: sourceOrg } = await supabase
      .from('businesses')
      .select('business_name')
      .eq('id', sourceId)
      .single();

    const { error: updateError } = await supabase
      .from('businesses')
      .update({
        business_name: sourceOrg?.business_name ? `${sourceOrg.business_name} (merged into BaT)` : 'Merged BaT Organization',
        is_public: false,
        status: 'merged'
      })
      .eq('id', sourceId);
    
    if (updateError) {
      console.warn(`    ⚠️  Update warning: ${updateError.message}`);
    }

    return true;
  } catch (error) {
    console.error(`    ❌ Merge error: ${error.message}`);
    return false;
  }
}

async function findAndMergeBaTDuplicates() {
  console.log('🔍 Searching for all Bring a Trailer organizations...\n');

  // Get ALL organizations (including non-public and merged)
  const { data: allOrgs, error } = await supabase
    .from('businesses')
    .select('id, business_name, legal_name, website, phone, email, city, state, zip_code, created_at, total_vehicles, is_public, status')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching organizations:', error);
    return;
  }

  // Filter for BaT organizations
  const batOrgs = (allOrgs || []).filter(org => isBaTOrganization(org));

  console.log(`📊 Found ${batOrgs.length} BaT-related organizations:\n`);
  
  batOrgs.forEach((org, i) => {
    console.log(`${i + 1}. ${org.business_name}`);
    console.log(`   ID: ${org.id}`);
    console.log(`   Website: ${org.website || 'none'}`);
    console.log(`   Vehicles: ${org.total_vehicles || 0}`);
    console.log(`   Public: ${org.is_public}, Status: ${org.status || 'active'}`);
    console.log(`   Created: ${org.created_at.substring(0, 10)}`);
    console.log('');
  });

  if (batOrgs.length <= 1) {
    console.log('✅ No duplicates found - only one BaT organization exists');
    return;
  }

  // Find the canonical BaT (prefer the one with most vehicles, then most data, then oldest)
  const canonical = batOrgs.reduce((best, current) => {
    const bestData = [best.website, best.phone, best.email, best.city].filter(Boolean).length;
    const currentData = [current.website, current.phone, current.email, current.city].filter(Boolean).length;
    
    if ((current.total_vehicles || 0) > (best.total_vehicles || 0)) return current;
    if ((best.total_vehicles || 0) > (current.total_vehicles || 0)) return best;
    if (currentData > bestData) return current;
    if (bestData > currentData) return best;
    return new Date(current.created_at) < new Date(best.created_at) ? current : best;
  });

  console.log(`\n🎯 Canonical BaT organization: ${canonical.business_name} (${canonical.id.substring(0, 8)}...)`);
  console.log(`   Vehicles: ${canonical.total_vehicles || 0}, Website: ${canonical.website || 'none'}\n`);

  // Merge all others into canonical
  const toMerge = batOrgs.filter(org => org.id !== canonical.id);
  const merged = [];

  for (const org of toMerge) {
    console.log(`\n✅ Found duplicate: ${org.business_name} (${org.id.substring(0, 8)}...)`);
    const success = await mergeOrganizations(org.id, canonical.id);
    if (success) {
      merged.push({ sourceId: org.id, targetId: canonical.id, name: org.business_name });
      console.log(`   ✅ Merged successfully`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total BaT organizations found: ${batOrgs.length}`);
  console.log(`Canonical organization: ${canonical.business_name} (${canonical.id.substring(0, 8)}...)`);
  console.log(`Duplicates merged: ${merged.length}`);
  
  if (merged.length > 0) {
    console.log('\nMerged duplicates:');
    merged.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.name} (${m.sourceId.substring(0, 8)}...) → ${m.targetId.substring(0, 8)}...`);
    });
  }

  console.log('\n✅ BaT duplicate scan complete!');
}

findAndMergeBaTDuplicates().catch(console.error);


