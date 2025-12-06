/**
 * INDEX ALL DOCUMENTS
 * 
 * Comprehensive script to index ALL documents in library_documents:
 * - Service manuals (service_manual)
 * - Material manuals (material_manual)
 * - TDS sheets (tds)
 * 
 * Uses the index-service-manual edge function via Supabase client
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
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Please set these in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Document types we can index
const INDEXABLE_TYPES = ['service_manual', 'material_manual', 'tds'];

async function indexDocument(documentId, mode = 'structure') {
  console.log(`\n📚 Indexing document ${documentId} [${mode}]...`);
  
  try {
    const { data, error } = await supabase.functions.invoke('index-service-manual', {
      body: { document_id: documentId, mode }
    });

    if (error) {
      console.error(`❌ Supabase error:`, error.message);
      return { success: false, error: error.message };
    }

    if (data?.error) {
      console.error(`❌ Function error:`, data.error);
      return { success: false, error: data.error };
    }

    if (data?.result) {
      console.log(`✅ Success`);
      if (mode === 'structure' && data.result.sections) {
        console.log(`   Found ${data.result.sections.length} sections`);
        console.log(`   Total pages: ${data.result.total_pages || 'unknown'}`);
      } else if (mode === 'chunk' && data.result.chunks_created) {
        console.log(`   Created ${data.result.chunks_created} chunks`);
        console.log(`   Indexed ${data.result.sections_indexed} sections`);
        if (data.result.errors && data.result.errors.length > 0) {
          console.log(`   ⚠️  Errors: ${data.result.errors.length}`);
          data.result.errors.forEach(err => console.log(`      - ${err}`));
        }
      }
      return { success: true, result: data.result };
    }

    return { success: true, result: data };
  } catch (error) {
    console.error(`❌ Exception:`, error.message);
    return { success: false, error: error.message };
  }
}

async function checkIndexingStatus(documentId) {
  // Check if document has chunks
  const { data: chunks, error } = await supabase
    .from('document_chunks')
    .select('id')
    .eq('document_id', documentId)
    .limit(1);

  if (error) {
    console.warn(`⚠️  Could not check status: ${error.message}`);
    return { indexed: false, chunkCount: 0 };
  }

  // Get total chunk count
  const { count } = await supabase
    .from('document_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId);

  return {
    indexed: (chunks?.length || 0) > 0,
    chunkCount: count || 0
  };
}

async function main() {
  console.log('🚀 INDEX ALL DOCUMENTS');
  console.log('='.repeat(60));
  console.log('');

  // Get all indexable documents
  const { data: docs, error } = await supabase
    .from('library_documents')
    .select('id, title, document_type, file_url, metadata')
    .in('document_type', INDEXABLE_TYPES)
    .order('document_type', { ascending: true })
    .order('title', { ascending: true });

  if (error) {
    console.error('❌ Error fetching documents:', error);
    return;
  }

  if (!docs || docs.length === 0) {
    console.log('📭 No indexable documents found.');
    console.log('\nTo add documents:');
    console.log('1. Upload via Reference Library UI (/library)');
    console.log('2. Or insert directly into library_documents table');
    console.log(`\nSupported types: ${INDEXABLE_TYPES.join(', ')}`);
    return;
  }

  console.log(`📚 Found ${docs.length} documents to process:`);
  console.log('');
  
  // Group by type
  const byType = docs.reduce((acc, doc) => {
    acc[doc.document_type] = (acc[doc.document_type] || []);
    acc[doc.document_type].push(doc);
    return acc;
  }, {});

  Object.entries(byType).forEach(([type, typeDocs]) => {
    console.log(`  ${type}: ${typeDocs.length} documents`);
  });

  console.log('');
  console.log('Checking indexing status...');
  console.log('');

  // Check status for each document
  const documentsToIndex = [];
  for (const doc of docs) {
    const status = await checkIndexingStatus(doc.id);
    const needsIndexing = !status.indexed || status.chunkCount === 0;
    
    if (needsIndexing) {
      documentsToIndex.push({ ...doc, status });
      console.log(`  ⏳ ${doc.title} (${doc.document_type}) - NOT INDEXED`);
    } else {
      console.log(`  ✅ ${doc.title} (${doc.document_type}) - ${status.chunkCount} chunks`);
    }
  }

  if (documentsToIndex.length === 0) {
    console.log('');
    console.log('✅ All documents are already indexed!');
    return;
  }

  console.log('');
  console.log(`📋 ${documentsToIndex.length} documents need indexing:`);
  documentsToIndex.forEach((doc, idx) => {
    console.log(`  ${idx + 1}. ${doc.title} (${doc.document_type})`);
  });

  console.log('');
  console.log('Starting indexing process...');
  console.log('');

  let successCount = 0;
  let failCount = 0;
  const results = [];

  for (let i = 0; i < documentsToIndex.length; i++) {
    const doc = documentsToIndex[i];
    
    console.log(`${'='.repeat(60)}`);
    console.log(`[${i + 1}/${documentsToIndex.length}] ${doc.title}`);
    console.log(`Type: ${doc.document_type}`);
    console.log(`ID: ${doc.id}`);
    console.log('');

    // Step 1: Extract structure
    console.log('Step 1: Extracting structure...');
    const structureResult = await indexDocument(doc.id, 'structure');
    
    if (!structureResult.success) {
      console.log(`❌ Structure extraction failed, skipping document`);
      failCount++;
      results.push({ doc, status: 'failed', error: structureResult.error });
      continue;
    }

    // Wait a bit before chunking
    console.log('⏳ Waiting 3 seconds before chunking...');
    await new Promise(r => setTimeout(r, 3000));

    // Step 2: Chunk and index
    console.log('');
    console.log('Step 2: Chunking and indexing...');
    const chunkResult = await indexDocument(doc.id, 'chunk');
    
    if (!chunkResult.success) {
      console.log(`⚠️  Chunking failed, but structure was extracted`);
      failCount++;
      results.push({ doc, status: 'partial', error: chunkResult.error });
    } else {
      console.log(`✅ Document fully indexed!`);
      successCount++;
      results.push({ doc, status: 'success', chunks: chunkResult.result?.chunks_created || 0 });
    }

    // Wait between documents to avoid rate limits
    if (i < documentsToIndex.length - 1) {
      console.log('');
      console.log('⏳ Waiting 5 seconds before next document...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Final summary
  console.log('');
  console.log('='.repeat(60));
  console.log('📊 INDEXING SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Total documents processed: ${documentsToIndex.length}`);
  console.log(`✅ Successfully indexed: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log('');

  // Show final chunk counts
  console.log('Final chunk counts by document:');
  for (const result of results) {
    const finalStatus = await checkIndexingStatus(result.doc.id);
    console.log(`  ${result.status === 'success' ? '✅' : result.status === 'partial' ? '⚠️' : '❌'} ${result.doc.title}: ${finalStatus.chunkCount} chunks`);
  }

  // Show summary by type
  const { data: summary } = await supabase
    .from('document_chunks')
    .select('document_type, document_id')
    .in('document_type', INDEXABLE_TYPES);

  if (summary) {
    const byType = summary.reduce((acc, chunk) => {
      const doc = docs.find(d => d.id === chunk.document_id);
      if (doc) {
        acc[doc.document_type] = (acc[doc.document_type] || 0) + 1;
      }
      return acc;
    }, {});

    console.log('');
    console.log('Total chunks by type:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} chunks`);
    });
  }

  console.log('');
  console.log('✅ Indexing process complete!');
  console.log('');
  console.log('You can now search indexed content:');
  console.log('  SELECT * FROM document_chunks WHERE document_type = \'service_manual\' AND content ILIKE \'%your search%\';');
}

main().catch(error => {
  console.error('');
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

