import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkStatus() {
  // Check all businesses with metadata to see what we have
  const { data: allWithMeta, error: metaErr } = await supabase
    .from('businesses')
    .select('id, name, metadata')
    .not('metadata', 'is', null)
    .limit(10);

  console.log('Sample businesses with metadata:', allWithMeta?.length);
  if (allWithMeta && allWithMeta.length > 0) {
    console.log('First one:', JSON.stringify(allWithMeta[0].metadata, null, 2));
  }
  if (metaErr) console.log('Meta error:', metaErr);

  // Count businesses with extraction configs
  const { data: withConfigs, error: configErr } = await supabase
    .from('businesses')
    .select('id, name, metadata')
    .not('metadata->extraction_config', 'is', null);

  if (configErr) console.log('Config query error:', configErr);

  // Count total businesses with websites
  const { data: totalBiz } = await supabase
    .from('businesses')
    .select('id')
    .not('website', 'is', null);

  // Count scrape_sources with configs
  const { data: sourcesWithConfigs } = await supabase
    .from('source_intelligence')
    .select('source_id, selector_hints')
    .not('selector_hints', 'is', null);

  // Count total scrape_sources
  const { data: totalSources } = await supabase
    .from('scrape_sources')
    .select('id');

  console.log('=== EXTRACTION CONFIG STATUS ===');
  console.log('Businesses with configs:', (withConfigs || []).length, '/', (totalBiz || []).length);
  console.log('Sources with configs:', (sourcesWithConfigs || []).length, '/', (totalSources || []).length);

  if (withConfigs && withConfigs.length) {
    console.log('\nConfigured businesses:');
    for (const b of withConfigs) {
      const confidence = b.metadata?.extraction_confidence || 0;
      console.log('  -', b.name, '(' + (confidence * 100) + '% confidence)');
    }
  }

  // Show sources without configs (for next batch)
  const { data: unconfigured } = await supabase
    .from('businesses')
    .select('id, name, website')
    .is('metadata->extraction_config', null)
    .not('website', 'is', null)
    .limit(20);

  console.log('\nNext batch of unconfigured businesses (' + (unconfigured || []).length + '):');
  for (const b of unconfigured || []) {
    console.log('  -', b.name, '-', b.website);
  }
}

checkStatus();
