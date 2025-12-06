/**
 * Helper script to bulk upload catalog URLs
 * Creates library_documents entries for material manuals and TDS sheets
 * 
 * Usage: node scripts/upload-catalog-urls.js
 * 
 * Edit the CATALOGS array below with your document URLs
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// EDIT THIS ARRAY with your catalog URLs
const CATALOGS = [
  // Example format:
  // {
  //   title: 'PPG Deltron Basecoat TDS',
  //   document_type: 'tds',
  //   file_url: 'https://www.ppgrefinish.com/tds/deltron-basecoat.pdf',
  //   brand: 'PPG',
  //   description: 'PPG Deltron basecoat technical data sheet'
  // },
  // {
  //   title: 'BASF Glasurit Product Catalog 2024',
  //   document_type: 'material_manual',
  //   file_url: 'https://www.glasurit.com/catalog/2024.pdf',
  //   brand: 'BASF',
  //   description: 'Complete Glasurit product catalog'
  // }
];

async function uploadCatalog(catalog) {
  // Get or create a reference library (use a general one or create per brand)
  let { data: library } = await supabase
    .from('reference_libraries')
    .select('id')
    .eq('year', 2024) // Use current year as placeholder
    .eq('make', 'General')
    .eq('series', 'All')
    .single();

  if (!library) {
    // Create a general library for material catalogs
    const { data: newLibrary } = await supabase
      .from('reference_libraries')
      .insert({
        year: 2024,
        make: 'General',
        series: 'All',
        body_style: 'All',
        description: 'General material catalogs and TDS sheets'
      })
      .select()
      .single();
    
    library = newLibrary;
  }

  // Check if document already exists
  const { data: existing } = await supabase
    .from('library_documents')
    .select('id')
    .eq('file_url', catalog.file_url)
    .single();

  if (existing) {
    console.log(`⏭️  Skipping (already exists): ${catalog.title}`);
    return existing.id;
  }

  // Insert document
  const { data: doc, error } = await supabase
    .from('library_documents')
    .insert({
      library_id: library.id,
      document_type: catalog.document_type,
      title: catalog.title,
      description: catalog.description,
      file_url: catalog.file_url,
      tags: catalog.brand ? [catalog.brand.toLowerCase()] : [],
      metadata: {
        brand: catalog.brand,
        uploaded_via: 'bulk_upload_script'
      },
      uploaded_by: (await supabase.auth.admin.listUsers()).data[0]?.id || null
    })
    .select()
    .single();

  if (error) {
    console.error(`❌ Error uploading ${catalog.title}:`, error);
    return null;
  }

  console.log(`✅ Uploaded: ${catalog.title} (${doc.id})`);
  return doc.id;
}

async function main() {
  if (CATALOGS.length === 0) {
    console.log('No catalogs to upload. Edit CATALOGS array in this script.');
    console.log('\nExample format:');
    console.log(`
const CATALOGS = [
  {
    title: 'PPG Deltron Basecoat TDS',
    document_type: 'tds',
    file_url: 'https://www.ppgrefinish.com/tds/deltron-basecoat.pdf',
    brand: 'PPG',
    description: 'PPG Deltron basecoat technical data sheet'
  }
];`);
    return;
  }

  console.log(`Uploading ${CATALOGS.length} catalogs...\n`);

  const documentIds = [];
  for (const catalog of CATALOGS) {
    const docId = await uploadCatalog(catalog);
    if (docId) documentIds.push(docId);
    await new Promise(r => setTimeout(r, 1000)); // Rate limit
  }

  console.log(`\n✅ Uploaded ${documentIds.length} documents`);
  console.log('\nNext step: Run indexing:');
  console.log('  node scripts/index-all-catalogs.js');
}

main().catch(console.error);

