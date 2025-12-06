/**
 * Index All Catalogs (Material Manuals & TDS Sheets)
 * Finds and indexes all material_manual and tds documents in library_documents
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

async function indexDocument(documentId, mode = 'structure') {
  console.log(`\n📚 Indexing document ${documentId} [${mode}]...`);
  
  const { data, error } = await supabase.functions.invoke('index-service-manual', {
    body: { document_id: documentId, mode }
  });

  if (error) {
    console.error(`❌ Error:`, error);
    return false;
  }

  if (data.error) {
    console.error(`❌ Function error:`, data.error);
    return false;
  }

  console.log(`✅ Success:`, JSON.stringify(data.result, null, 2));
  return true;
}

async function main() {
  // Get all material manuals and TDS sheets
  const { data: docs, error } = await supabase
    .from('library_documents')
    .select('id, title, document_type')
    .in('document_type', ['material_manual', 'tds']);

  if (error) {
    console.error('Error fetching documents:', error);
    return;
  }

  if (docs.length === 0) {
    console.log('No material manuals or TDS sheets found in database.');
    console.log('\nTo add documents:');
    console.log('1. Upload via Reference Library UI');
    console.log('2. Or insert directly into library_documents table with document_type = "material_manual" or "tds"');
    return;
  }

  console.log(`Found ${docs.length} documents to index:`);
  docs.forEach(doc => {
    console.log(`  - ${doc.document_type}: ${doc.title}`);
  });

  for (const doc of docs) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Document: ${doc.title}`);
    console.log(`Type: ${doc.document_type}`);
    console.log(`ID: ${doc.id}`);
    
    // Step 1: Extract structure
    console.log('\nStep 1: Extracting structure...');
    const structureOk = await indexDocument(doc.id, 'structure');
    if (!structureOk) {
      console.log('Skipping chunking due to structure error');
      continue;
    }

    // Wait a bit
    await new Promise(r => setTimeout(r, 2000));

    // Step 2: Chunk and index
    console.log('\nStep 2: Chunking and indexing...');
    await indexDocument(doc.id, 'chunk');

    // Wait between documents
    await new Promise(r => setTimeout(r, 5000));
  }

  // Show summary
  const { data: summary } = await supabase
    .from('document_chunks')
    .select('document_type, document_id')
    .in('document_type', ['material_manual', 'tds']);

  const byType = summary?.reduce((acc, chunk) => {
    acc[chunk.document_type] = (acc[chunk.document_type] || 0) + 1;
    return acc;
  }, {});

  console.log('\n✅ Indexing complete!');
  console.log('\nSummary:');
  if (byType) {
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} chunks`);
    });
  }
}

main().catch(console.error);

