/**
 * ROBUST DOCUMENT INDEXING SCRIPT
 * 
 * Production-ready script for indexing thousands of documents:
 * - Automatic retries with exponential backoff
 * - Resume capability (saves progress)
 * - Error handling and logging
 * - Batch processing
 * - Progress tracking
 * - Timeout handling
 * 
 * Usage:
 *   node scripts/index-all-documents-robust.js [--resume] [--limit N] [--type service_manual]
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configuration
const INDEXABLE_TYPES = ['service_manual', 'material_manual', 'tds'];
const STATE_FILE = path.join(__dirname, '../tmp/indexing-state.json');
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 5000; // 5 seconds
const MAX_RETRY_DELAY = 60000; // 60 seconds
const DELAY_BETWEEN_DOCS = 5000; // 5 seconds
const DELAY_BETWEEN_STEPS = 3000; // 3 seconds
const TIMEOUT_MS = 300000; // 5 minutes per operation

// Parse command line args
const args = process.argv.slice(2);
const shouldResume = args.includes('--resume');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const typeArg = args.find(arg => arg.startsWith('--type='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;
const docType = typeArg ? typeArg.split('=')[1] : null;

// Load/save state
async function loadState() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {
      completed: [],
      failed: [],
      inProgress: null,
      startTime: null
    };
  }
}

async function saveState(state) {
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn('⚠️  Could not save state:', error.message);
  }
}

// Sleep utility
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Exponential backoff retry
async function retryWithBackoff(fn, maxRetries = MAX_RETRIES, description = 'operation') {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), TIMEOUT_MS)
        )
      ]);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxRetries - 1;
      
      if (isLastAttempt) {
        console.error(`❌ ${description} failed after ${maxRetries} attempts:`, error.message);
        throw error;
      }
      
      const delay = Math.min(
        INITIAL_RETRY_DELAY * Math.pow(2, attempt),
        MAX_RETRY_DELAY
      );
      
      console.warn(`⚠️  ${description} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay/1000}s...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

// Check if document is indexed
async function checkIndexingStatus(documentId) {
  const { count, error } = await supabase
    .from('document_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId);
  
  if (error) {
    console.warn(`⚠️  Could not check status: ${error.message}`);
    return { indexed: false, chunkCount: 0 };
  }
  
  return {
    indexed: (count || 0) > 0,
    chunkCount: count || 0
  };
}

// Index document with retries
async function indexDocument(documentId, mode = 'structure', docTitle = '') {
  const modeLabel = mode === 'structure' ? 'structure extraction' : 'chunking';
  const fullDescription = `${modeLabel} for "${docTitle}"`;
  
  return await retryWithBackoff(async () => {
    const { data, error } = await supabase.functions.invoke('index-service-manual', {
      body: { document_id: documentId, mode }
    });

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    if (data?.error) {
      throw new Error(`Function error: ${data.error}`);
    }

    return data?.result || data;
  }, MAX_RETRIES, fullDescription);
}

// Process a single document
async function processDocument(doc, state) {
  const docId = doc.id;
  const docTitle = doc.title;
  const docType = doc.document_type;
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📄 ${docTitle}`);
  console.log(`   Type: ${docType}`);
  console.log(`   ID: ${docId}`);
  console.log('');
  
  // Update state
  state.inProgress = { id: docId, title: docTitle, step: 'starting' };
  await saveState(state);
  
  try {
    // Step 1: Extract structure
    console.log('📋 Step 1: Extracting structure...');
    state.inProgress.step = 'structure';
    await saveState(state);
    
    const structureResult = await indexDocument(docId, 'structure', docTitle);
    
    if (!structureResult || !structureResult.sections) {
      throw new Error('Structure extraction returned no sections');
    }
    
    console.log(`   ✅ Found ${structureResult.sections.length} sections`);
    console.log(`   📄 Total pages: ${structureResult.total_pages || 'unknown'}`);
    
    // Wait before chunking
    console.log(`   ⏳ Waiting ${DELAY_BETWEEN_STEPS/1000}s before chunking...`);
    await sleep(DELAY_BETWEEN_STEPS);
    
    // Step 2: Chunk and index
    console.log('');
    console.log('📚 Step 2: Chunking and indexing...');
    state.inProgress.step = 'chunking';
    await saveState(state);
    
    const chunkResult = await indexDocument(docId, 'chunk', docTitle);
    
    if (!chunkResult) {
      throw new Error('Chunking returned no result');
    }
    
    const chunksCreated = chunkResult.chunks_created || 0;
    const sectionsIndexed = chunkResult.sections_indexed || 0;
    
    console.log(`   ✅ Created ${chunksCreated} chunks`);
    console.log(`   📑 Indexed ${sectionsIndexed} sections`);
    
    if (chunkResult.errors && chunkResult.errors.length > 0) {
      console.log(`   ⚠️  ${chunkResult.errors.length} section errors:`);
      chunkResult.errors.slice(0, 3).forEach(err => {
        console.log(`      - ${err}`);
      });
      if (chunkResult.errors.length > 3) {
        console.log(`      ... and ${chunkResult.errors.length - 3} more`);
      }
    }
    
    // Verify final status
    const finalStatus = await checkIndexingStatus(docId);
    console.log(`   ✅ Final status: ${finalStatus.chunkCount} chunks indexed`);
    
    // Mark as completed
    state.completed.push({
      id: docId,
      title: docTitle,
      type: docType,
      chunks: finalStatus.chunkCount,
      timestamp: new Date().toISOString()
    });
    state.inProgress = null;
    await saveState(state);
    
    return { success: true, chunks: finalStatus.chunkCount };
    
  } catch (error) {
    console.error(`   ❌ Failed: ${error.message}`);
    
    // Mark as failed
    state.failed.push({
      id: docId,
      title: docTitle,
      type: docType,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    state.inProgress = null;
    await saveState(state);
    
    return { success: false, error: error.message };
  }
}

// Main function
async function main() {
  console.log('🚀 ROBUST DOCUMENT INDEXING');
  console.log('='.repeat(70));
  console.log('');
  
  // Load state
  let state = await loadState();
  
  if (shouldResume && state.inProgress) {
    console.log('📂 Resuming from previous run...');
    console.log(`   In progress: ${state.inProgress.title}`);
    console.log(`   Step: ${state.inProgress.step}`);
    console.log('');
  }
  
  if (state.completed.length > 0) {
    console.log(`✅ Previously completed: ${state.completed.length} documents`);
  }
  if (state.failed.length > 0) {
    console.log(`❌ Previously failed: ${state.failed.length} documents`);
  }
  console.log('');
  
  // Get documents to process
  let query = supabase
    .from('library_documents')
    .select('id, title, document_type, file_url, metadata')
    .in('document_type', docType ? [docType] : INDEXABLE_TYPES)
    .order('document_type', { ascending: true })
    .order('title', { ascending: true });
  
  if (limit) {
    query = query.limit(limit);
  }
  
  const { data: allDocs, error } = await query;
  
  if (error) {
    console.error('❌ Error fetching documents:', error);
    return;
  }
  
  if (!allDocs || allDocs.length === 0) {
    console.log('📭 No documents found.');
    return;
  }
  
  console.log(`📚 Found ${allDocs.length} documents`);
  
  // Filter out already completed
  const completedIds = new Set(state.completed.map(d => d.id));
  const failedIds = new Set(state.failed.map(d => d.id));
  
  // Check indexing status for all documents
  console.log('🔍 Checking indexing status...');
  const docsToProcess = [];
  
  for (const doc of allDocs) {
    // Skip if already completed
    if (completedIds.has(doc.id)) {
      continue;
    }
    
    // Check if already indexed
    const status = await checkIndexingStatus(doc.id);
    if (status.indexed && status.chunkCount > 0) {
      // Mark as completed
      state.completed.push({
        id: doc.id,
        title: doc.title,
        type: doc.document_type,
        chunks: status.chunkCount,
        timestamp: new Date().toISOString(),
        note: 'Already indexed'
      });
      await saveState(state);
      console.log(`  ✅ ${doc.title} - Already indexed (${status.chunkCount} chunks)`);
      continue;
    }
    
    docsToProcess.push(doc);
  }
  
  if (docsToProcess.length === 0) {
    console.log('');
    console.log('✅ All documents are already indexed!');
    return;
  }
  
  console.log(`\n📋 ${docsToProcess.length} documents need indexing:`);
  docsToProcess.forEach((doc, idx) => {
    const status = failedIds.has(doc.id) ? '❌ (previously failed)' : '⏳';
    console.log(`  ${idx + 1}. ${status} ${doc.title} (${doc.document_type})`);
  });
  
  console.log('');
  console.log('Starting indexing process...');
  console.log(`   Max retries: ${MAX_RETRIES}`);
  console.log(`   Timeout: ${TIMEOUT_MS/1000}s per operation`);
  console.log(`   Delay between docs: ${DELAY_BETWEEN_DOCS/1000}s`);
  console.log('');
  
  if (!state.startTime) {
    state.startTime = new Date().toISOString();
  }
  
  let successCount = 0;
  let failCount = 0;
  
  // Process each document
  for (let i = 0; i < docsToProcess.length; i++) {
    const doc = docsToProcess[i];
    const result = await processDocument(doc, state);
    
    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }
    
    // Wait between documents (except last one)
    if (i < docsToProcess.length - 1) {
      console.log(`\n⏳ Waiting ${DELAY_BETWEEN_DOCS/1000}s before next document...`);
      await sleep(DELAY_BETWEEN_DOCS);
    }
  }
  
  // Final summary
  const endTime = new Date();
  const startTime = new Date(state.startTime);
  const duration = Math.round((endTime - startTime) / 1000);
  
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Total documents processed: ${docsToProcess.length}`);
  console.log(`✅ Successfully indexed: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`⏱️  Total time: ${Math.floor(duration/60)}m ${duration%60}s`);
  console.log('');
  
  // Show final chunk counts
  const { data: summary } = await supabase
    .from('document_chunks')
    .select('document_type')
    .in('document_type', INDEXABLE_TYPES);
  
  if (summary) {
    const byType = summary.reduce((acc, chunk) => {
      acc[chunk.document_type] = (acc[chunk.document_type] || 0) + 1;
      return acc;
    }, {});
    
    console.log('📈 Total chunks by type:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} chunks`);
    });
  }
  
  // Show failed documents
  if (state.failed.length > 0) {
    console.log('');
    console.log('❌ Failed documents (can retry with --resume):');
    state.failed.slice(-10).forEach(f => {
      console.log(`  - ${f.title} (${f.type}): ${f.error}`);
    });
    if (state.failed.length > 10) {
      console.log(`  ... and ${state.failed.length - 10} more`);
    }
  }
  
  console.log('');
  console.log('✅ Indexing process complete!');
  console.log('');
  console.log('State saved to:', STATE_FILE);
  console.log('You can resume with: node scripts/index-all-documents-robust.js --resume');
  console.log('');
}

main().catch(error => {
  console.error('');
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

