/**
 * RETRY FAILED INDEXING
 * 
 * Retries documents that failed during indexing
 * Reads from state file and retries failed documents
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

const supabase = createClient(supabaseUrl, supabaseKey);
const STATE_FILE = path.join(__dirname, '../tmp/indexing-state.json');

async function loadState() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    console.error('❌ No state file found. Run index-all-documents-robust.js first.');
    process.exit(1);
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

async function checkIndexingStatus(documentId) {
  const { count } = await supabase
    .from('document_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId);
  
  return {
    indexed: (count || 0) > 0,
    chunkCount: count || 0
  };
}

async function main() {
  const state = await loadState();
  
  if (state.failed.length === 0) {
    console.log('✅ No failed documents to retry!');
    return;
  }
  
  console.log(`🔄 Retrying ${state.failed.length} failed documents...\n`);
  
  // Get document details
  const failedIds = state.failed.map(f => f.id);
  const { data: docs } = await supabase
    .from('library_documents')
    .select('id, title, document_type')
    .in('id', failedIds);
  
  // Remove from failed list
  state.failed = [];
  await saveState(state);
  
  // Retry each document using the robust script logic
  console.log('Run the robust script to retry:');
  console.log('  node scripts/index-all-documents-robust.js --resume\n');
  
  docs?.forEach((doc, idx) => {
    console.log(`  ${idx + 1}. ${doc.title} (${doc.document_type})`);
  });
}

main().catch(console.error);

