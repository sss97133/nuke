#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runQuery(name, sql) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`QUERY: ${name}`);
  console.log('='.repeat(80));

  try {
    const { data, error } = await supabase.rpc('exec_sql', { query: sql });

    if (error) {
      console.error('Error:', error);
      return null;
    }

    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (err) {
    console.error('Exception:', err);
    return null;
  }
}

async function main() {
  console.log('Organization Provenance Audit');
  console.log('Database:', SUPABASE_URL);
  console.log('Timestamp:', new Date().toISOString());

  // Query 1: Overall provenance health
  await runQuery('Overall Provenance Health', `
    SELECT
      COUNT(*) as total_orgs,
      COUNT(discovered_by) as has_discovered_by,
      COUNT(source_url) as has_source_url,
      COUNT(website) as has_website,
      COUNT(metadata->'org_intake') as has_intake_metadata
    FROM businesses
    WHERE is_public = true;
  `);

  // Query 2: Breakdown by provenance quality
  await runQuery('Provenance Quality Breakdown', `
    SELECT
      CASE
        WHEN discovered_by IS NOT NULL AND (source_url IS NOT NULL OR website IS NOT NULL) THEN 'good_provenance'
        WHEN discovered_by IS NOT NULL THEN 'has_user_no_url'
        WHEN source_url IS NOT NULL OR website IS NOT NULL THEN 'has_url_no_user'
        ELSE 'orphan_garbage'
      END as provenance_quality,
      COUNT(*) as count
    FROM businesses
    WHERE is_public = true
    GROUP BY 1
    ORDER BY count DESC;
  `);

  // Query 3: Sample garbage orgs
  await runQuery('Sample Garbage Orgs (No Provenance)', `
    SELECT
      id,
      business_name,
      business_type,
      created_at,
      discovered_by,
      source_url,
      website,
      description IS NOT NULL as has_description,
      logo_url IS NOT NULL as has_logo
    FROM businesses
    WHERE is_public = true
      AND discovered_by IS NULL
      AND source_url IS NULL
      AND website IS NULL
    ORDER BY created_at DESC
    LIMIT 20;
  `);

  // Query 4: org_intake metadata patterns
  await runQuery('Org Intake Metadata Patterns', `
    SELECT
      metadata->'org_intake'->>'method' as creation_method,
      COUNT(*) as count
    FROM businesses
    WHERE metadata->'org_intake' IS NOT NULL
    GROUP BY 1
    ORDER BY count DESC;
  `);

  // Query 5: Orgs without active contributors
  await runQuery('Orgs Without Active Contributors', `
    SELECT
      b.id,
      b.business_name,
      b.created_at,
      COUNT(oc.id) as contributor_count
    FROM businesses b
    LEFT JOIN organization_contributors oc ON oc.organization_id = b.id AND oc.status = 'active'
    WHERE b.is_public = true
    GROUP BY b.id, b.business_name, b.created_at
    HAVING COUNT(oc.id) = 0
    ORDER BY b.created_at DESC
    LIMIT 20;
  `);
}

main().catch(console.error);
