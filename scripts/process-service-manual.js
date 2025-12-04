#!/usr/bin/env node
/**
 * Process a service manual - extract pages and index topics
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function processManual() {
  console.log('📚 Processing Service Manuals\n');
  
  // Get the 1987 manual
  const { data: manual, error } = await supabase
    .from('library_documents')
    .select('*')
    .eq('title', '1987 Chevrolet Light Duty Truck Service Manual')
    .single();
  
  if (error || !manual) {
    console.error('Manual not found:', error?.message);
    return;
  }
  
  console.log(`Found: ${manual.title}`);
  console.log(`URL: ${manual.file_url}\n`);
  
  // First, create a catalog_source for this manual if it doesn't exist
  const { data: catalog, error: catalogError } = await supabase
    .from('catalog_sources')
    .upsert({
      name: manual.title,
      provider: 'GM Factory',
      base_url: 'http://www.73-87chevytrucks.com',
      pdf_document_id: manual.id
    }, { onConflict: 'pdf_document_id' })
    .select('id')
    .single();
  
  if (catalogError) {
    console.error('Failed to create catalog source:', catalogError.message);
    return;
  }
  
  console.log(`Catalog source ID: ${catalog.id}\n`);
  
  // Call the extraction function
  console.log('Calling extract-manual-pages function...');
  
  const { data, error: extractError } = await supabase.functions.invoke('extract-manual-pages', {
    body: {
      document_id: catalog.id,
      pdf_url: manual.file_url
    }
  });
  
  if (extractError) {
    console.error('❌ Extraction failed:', extractError.message);
    return;
  }
  
  console.log('\n✅ SUCCESS!');
  console.log(JSON.stringify(data, null, 2));
}

processManual().catch(console.error);



