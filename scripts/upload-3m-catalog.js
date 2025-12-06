/**
 * Upload 3M Product Catalog
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

async function main() {
  // Get or create general library
  let { data: library } = await supabase
    .from('reference_libraries')
    .select('id')
    .eq('year', 2024)
    .eq('make', 'General')
    .eq('series', 'All')
    .eq('body_style', 'All')
    .single();

  if (!library) {
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

  const catalog = {
    title: '3M Automotive Aftermarket Division Product Catalogue 2024',
    document_type: 'material_manual',
    file_url: 'https://multimedia.3m.com/mws/media/2281223O/3m-aad-product-catalogue-2024-gb.pdf',
    brand: '3M',
    description: '3M Automotive Aftermarket Division complete product catalog 2024'
  };

  // Check if already exists
  const { data: existing } = await supabase
    .from('library_documents')
    .select('id')
    .eq('file_url', catalog.file_url)
    .single();

  if (existing) {
    console.log(`✅ Already exists: ${catalog.title}`);
    console.log(`Document ID: ${existing.id}`);
    console.log('\nTo index it, run:');
    console.log(`  node -e "import('./scripts/index-all-catalogs.js')"`);
    return existing.id;
  }

  // Get a user ID (or use service role)
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users?.[0]?.id || null;

  // Insert document
  const { data: doc, error } = await supabase
    .from('library_documents')
    .insert({
      library_id: library.id,
      document_type: catalog.document_type,
      title: catalog.title,
      description: catalog.description,
      file_url: catalog.file_url,
      tags: ['3m', 'automotive', 'aftermarket', 'catalog'],
      metadata: {
        brand: catalog.brand,
        uploaded_via: 'script',
        year: 2024
      },
      uploaded_by: userId
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`✅ Uploaded: ${catalog.title}`);
  console.log(`Document ID: ${doc.id}`);
  console.log('\nNext: Index it with:');
  console.log(`  node scripts/index-all-catalogs.js`);
  
  return doc.id;
}

main().catch(console.error);

