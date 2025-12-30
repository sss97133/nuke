#!/usr/bin/env node
/**
 * Find and merge duplicate organizations across the entire database
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

// Normalization functions
function normalizeWebsite(url) {
  if (!url) return null;
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .trim();
}

function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/\D/g, '');
}

function normalizeString(str) {
  if (!str) return null;
  return str.toLowerCase().trim();
}

function similarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);
  if (s1 === s2) return 1;
  
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

function areDuplicates(org1, org2) {
  // Exact website match (highest confidence)
  const website1 = normalizeWebsite(org1.website);
  const website2 = normalizeWebsite(org2.website);
  if (website1 && website2 && website1 === website2) {
    return { isDuplicate: true, confidence: 0.95, reason: 'exact_website_match' };
  }

  // Exact phone match
  const phone1 = normalizePhone(org1.phone);
  const phone2 = normalizePhone(org2.phone);
  if (phone1 && phone2 && phone1 === phone2 && phone1.length >= 10) {
    return { isDuplicate: true, confidence: 0.90, reason: 'exact_phone_match' };
  }

  // Exact email match
  if (org1.email && org2.email && org1.email.toLowerCase() === org2.email.toLowerCase()) {
    return { isDuplicate: true, confidence: 0.90, reason: 'exact_email_match' };
  }

  // Name similarity + location match
  const nameSim = similarity(org1.business_name, org2.business_name);
  const sameCity = org1.city && org2.city && normalizeString(org1.city) === normalizeString(org2.city);
  const sameState = org1.state && org2.state && normalizeString(org1.state) === normalizeString(org2.state);
  const sameZip = org1.zip_code && org2.zip_code && org1.zip_code === org2.zip_code;

  if (nameSim >= 0.85 && (sameCity || sameZip)) {
    return { isDuplicate: true, confidence: 0.80, reason: 'name_location_match' };
  }

  if (nameSim >= 0.90) {
    return { isDuplicate: true, confidence: 0.75, reason: 'high_name_similarity' };
  }

  // Legal name match
  if (org1.legal_name && org2.legal_name) {
    const legalSim = similarity(org1.legal_name, org2.legal_name);
    if (legalSim >= 0.90) {
      return { isDuplicate: true, confidence: 0.85, reason: 'legal_name_match' };
    }
  }

  return { isDuplicate: false, confidence: 0, reason: 'no_match' };
}

async function mergeOrganizations(sourceId, targetId) {
  console.log(`\n  🔄 Merging ${sourceId} → ${targetId}...`);
  
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
        business_name: sourceOrg?.business_name ? `${sourceOrg.business_name} (merged)` : 'Merged Organization',
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

async function findAndMergeAllDuplicates() {
  console.log('🔍 Scanning for duplicate organizations...\n');

  // Get all public organizations
  const { data: orgs, error } = await supabase
    .from('businesses')
    .select('id, business_name, legal_name, website, phone, email, city, state, zip_code, business_type, created_at, total_vehicles')
    .eq('is_public', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching organizations:', error);
    return;
  }

  if (!orgs || orgs.length === 0) {
    console.log('ℹ️  No organizations found');
    return;
  }

  console.log(`📊 Found ${orgs.length} organizations to check\n`);

  const processed = new Set();
  const merged = [];
  let checked = 0;

  for (let i = 0; i < orgs.length; i++) {
    const org1 = orgs[i];
    
    if (processed.has(org1.id)) {
      continue; // Already merged
    }

    // Check against all other orgs
    for (let j = i + 1; j < orgs.length; j++) {
      const org2 = orgs[j];
      
      if (processed.has(org2.id)) {
        continue; // Already merged
      }

      checked++;
      const { isDuplicate, confidence, reason } = areDuplicates(org1, org2);

      if (isDuplicate && confidence >= 0.75) {
        console.log(`\n✅ Found duplicate (${confidence.toFixed(2)} confidence, ${reason}):`);
        console.log(`   1. ${org1.business_name} (${org1.id.substring(0, 8)}...) - ${org1.total_vehicles || 0} vehicles`);
        console.log(`   2. ${org2.business_name} (${org2.id.substring(0, 8)}...) - ${org2.total_vehicles || 0} vehicles`);

        // Determine target (keep the one with more data or older)
        const org1DataCount = [
          org1.website, org1.phone, org1.email, org1.city, org1.state
        ].filter(Boolean).length;
        
        const org2DataCount = [
          org2.website, org2.phone, org2.email, org2.city, org2.state
        ].filter(Boolean).length;

        // Prefer the one with more vehicles, then more data, then older
        let targetId, sourceId;
        if ((org1.total_vehicles || 0) > (org2.total_vehicles || 0)) {
          targetId = org1.id;
          sourceId = org2.id;
        } else if ((org2.total_vehicles || 0) > (org1.total_vehicles || 0)) {
          targetId = org2.id;
          sourceId = org1.id;
        } else if (org1DataCount > org2DataCount) {
          targetId = org1.id;
          sourceId = org2.id;
        } else if (org2DataCount > org1DataCount) {
          targetId = org2.id;
          sourceId = org1.id;
        } else {
          // Keep the older one
          targetId = new Date(org1.created_at) < new Date(org2.created_at) ? org1.id : org2.id;
          sourceId = targetId === org1.id ? org2.id : org1.id;
        }

        console.log(`   → Merging into: ${targetId.substring(0, 8)}...`);

        const success = await mergeOrganizations(sourceId, targetId);
        
        if (success) {
          processed.add(sourceId);
          merged.push({ sourceId, targetId, reason, confidence });
          console.log(`   ✅ Merged successfully`);
        }
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Organizations checked: ${checked}`);
  console.log(`Duplicates found and merged: ${merged.length}`);
  
  if (merged.length > 0) {
    console.log('\nMerged pairs:');
    merged.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.sourceId.substring(0, 8)}... → ${m.targetId.substring(0, 8)}... (${m.reason}, ${m.confidence.toFixed(2)})`);
    });
  }

  console.log('\n✅ Duplicate scan complete!');
}

findAndMergeAllDuplicates().catch(console.error);

