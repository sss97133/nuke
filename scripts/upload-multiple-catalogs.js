/**
 * Bulk Upload Multiple Catalogs
 * Uploads Snap-on, Car-O-Liner, ATI Tools, and other catalogs
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

const CATALOGS = [
  // Snap-on Catalogs
  {
    title: 'Snap-on Catalogue 2023',
    document_type: 'material_manual',
    file_url: 'https://snapon.com.sg/wp-content/uploads/2024/09/Snap-on-Catalogue-2023.pdf',
    brand: 'Snap-on',
    description: 'Snap-on professional tools catalog 2023',
    tags: ['snap-on', 'tools', 'professional', 'catalog']
  },
  {
    title: 'Snap-on Lindström Catalog 2024',
    document_type: 'material_manual',
    file_url: 'https://snapon.com.sg/wp-content/uploads/2024/09/Lindstrm_Cat_English_2024.pdf',
    brand: 'Snap-on',
    description: 'Snap-on Lindström tools catalog 2024',
    tags: ['snap-on', 'lindstrom', 'tools', 'catalog']
  },
  {
    title: 'Car-O-Liner Solutions Catalog 2023',
    document_type: 'material_manual',
    file_url: 'https://snapon.com.sg/wp-content/uploads/2024/09/Car-o-liner_Solutions_Catalog_2023-08-23_EN.pdf',
    brand: 'Car-O-Liner',
    description: 'Car-O-Liner collision repair equipment and solutions catalog 2023',
    tags: ['car-o-liner', 'collision', 'equipment', 'repair', 'catalog']
  },
  {
    title: 'ATI Tools Catalog',
    document_type: 'material_manual',
    file_url: 'https://snapon.com.sg/wp-content/uploads/2024/09/ATI_Tools_Catalog.pdf',
    brand: 'ATI Tools',
    description: 'ATI Tools professional automotive tools catalog',
    tags: ['ati', 'tools', 'automotive', 'catalog']
  }
];

async function getOrCreateLibrary() {
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

  return library;
}

async function uploadCatalog(catalog, libraryId) {
  // Check if already exists
  const { data: existing } = await supabase
    .from('library_documents')
    .select('id, title')
    .eq('file_url', catalog.file_url)
    .single();

  if (existing) {
    console.log(`⏭️  Already exists: ${catalog.title}`);
    return existing.id;
  }

  // Get a user ID
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users?.[0]?.id || null;

  // Insert document
  const { data: doc, error } = await supabase
    .from('library_documents')
    .insert({
      library_id: libraryId,
      document_type: catalog.document_type,
      title: catalog.title,
      description: catalog.description,
      file_url: catalog.file_url,
      tags: catalog.tags || [],
      metadata: {
        brand: catalog.brand,
        uploaded_via: 'bulk_upload_script',
        year: 2023 // or 2024 based on title
      },
      uploaded_by: userId
    })
    .select()
    .single();

  if (error) {
    console.error(`❌ Error uploading ${catalog.title}:`, error.message);
    return null;
  }

  console.log(`✅ Uploaded: ${catalog.title}`);
  return doc.id;
}

async function main() {
  console.log(`Uploading ${CATALOGS.length} catalogs...\n`);

  const library = await getOrCreateLibrary();
  if (!library) {
    console.error('Failed to get/create library');
    return;
  }

  const documentIds = [];
  for (const catalog of CATALOGS) {
    const docId = await uploadCatalog(catalog, library.id);
    if (docId) documentIds.push(docId);
    await new Promise(r => setTimeout(r, 1000)); // Rate limit
  }

  console.log(`\n✅ Uploaded ${documentIds.length} documents`);
  console.log('\nNext step: Index all catalogs:');
  console.log('  node scripts/index-all-catalogs.js');
  
  return documentIds;
}

main().catch(console.error);

