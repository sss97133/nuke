/**
 * Index all service manuals
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

async function indexManual(documentId, mode = 'structure') {
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
  // Get all service manuals
  const { data: manuals, error } = await supabase
    .from('library_documents')
    .select('id, title')
    .eq('document_type', 'service_manual');

  if (error) {
    console.error('Error fetching manuals:', error);
    return;
  }

  console.log(`Found ${manuals.length} service manuals to index`);

  for (const manual of manuals) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Manual: ${manual.title}`);
    console.log(`ID: ${manual.id}`);
    
    // Step 1: Extract structure
    console.log('\nStep 1: Extracting structure...');
    const structureOk = await indexManual(manual.id, 'structure');
    if (!structureOk) {
      console.log('Skipping chunking due to structure error');
      continue;
    }

    // Wait a bit
    await new Promise(r => setTimeout(r, 2000));

    // Step 2: Chunk and index
    console.log('\nStep 2: Chunking and indexing...');
    await indexManual(manual.id, 'chunk');

    // Wait between manuals
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('\n✅ All manuals indexed!');
}

main().catch(console.error);

