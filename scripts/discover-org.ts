#!/usr/bin/env tsx
/**
 * Discover Organization Full
 * 
 * Single-organization adaptive discovery tool.
 * 
 * Usage:
 *   npm run discover-org -- <organization_id>
 *   npm run discover-org -- <organization_id> --force
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function discoverOrganization(organizationId: string, forceRediscover: boolean = false) {
  console.log('🔍 Discover Organization Full\n');
  console.log(`Organization ID: ${organizationId}`);
  console.log(`Force Rediscover: ${forceRediscover ? 'YES' : 'NO'}\n`);

  try {
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/discover-organization-full`;
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        force_rediscover: forceRediscover,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    const data = result.result;

    console.log('✅ Discovery Complete!\n');
    console.log('Results:');
    console.log(`  - Website: ${data.website}`);
    console.log(`  - Site Type: ${data.site_structure.site_type}`);
    if (data.site_structure.platform) {
      console.log(`  - Platform: ${data.site_structure.platform}`);
    }
    console.log(`  - Page Types: ${data.site_structure.page_types.length}`);
    console.log(`  - Extraction Patterns: ${data.extraction_patterns.length}`);
    console.log(`  - Patterns Stored: ${data.learned_patterns_stored ? 'YES' : 'NO'}`);
    console.log(`  - Vehicles Found: ${data.vehicles_found}`);
    console.log(`  - Vehicles Queued: ${data.vehicles_extracted}`);
    console.log(`  - Vehicle Profiles Created: ${data.vehicles_created}`);
    console.log(`  - Images Found: ${data.images_found}\n`);

    if (data.extraction_patterns.length > 0) {
      console.log('Extraction Patterns:');
      data.extraction_patterns.slice(0, 5).forEach((pattern: any) => {
        console.log(`  - ${pattern.field_name}: ${pattern.selectors.join(', ')} (${pattern.extraction_method}, confidence: ${pattern.confidence})`);
      });
      if (data.extraction_patterns.length > 5) {
        console.log(`  ... and ${data.extraction_patterns.length - 5} more`);
      }
      console.log('');
    }

    if (data.next_steps && data.next_steps.length > 0) {
      console.log('Next Steps:');
      data.next_steps.forEach((step: string) => {
        console.log(`  - ${step}`);
      });
    }

    return result;
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const organizationId = args[0];
const forceRediscover = args.includes('--force') || args.includes('-f');

if (!organizationId) {
  console.error('❌ Organization ID required');
  console.error('\nUsage:');
  console.error('  npm run discover-org -- <organization_id>');
  console.error('  npm run discover-org -- <organization_id> --force');
  process.exit(1);
}

discoverOrganization(organizationId, forceRediscover).catch(console.error);

