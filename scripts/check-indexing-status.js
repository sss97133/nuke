import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: chunks, error } = await supabase
    .from('document_chunks')
    .select('document_type, document_id, library_documents!fk_document(title, document_type)')
    .order('document_type');

  if (error) {
    console.error('Error:', error);
    return;
  }

  const byDoc = {};
  chunks?.forEach(chunk => {
    const title = chunk.library_documents.title;
    if (!byDoc[title]) {
      byDoc[title] = { 
        type: chunk.document_type, 
        count: 0,
        docId: chunk.document_id
      };
    }
    byDoc[title].count++;
  });

  console.log('📊 INDEXED DOCUMENTS:\n');
  Object.entries(byDoc).forEach(([title, info]) => {
    console.log(`  ✅ ${title}`);
    console.log(`     Type: ${info.type}, Chunks: ${info.count}`);
  });

  const totals = chunks?.reduce((acc, c) => {
    acc[c.document_type] = (acc[c.document_type] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n📈 TOTAL CHUNKS BY TYPE:`);
  Object.entries(totals || {}).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} chunks`);
  });

  // Check which documents are NOT indexed
  const { data: allDocs } = await supabase
    .from('library_documents')
    .select('id, title, document_type')
    .in('document_type', ['service_manual', 'material_manual', 'tds']);

  const indexedDocIds = new Set(chunks?.map(c => c.document_id) || []);
  const unindexed = allDocs?.filter(doc => !indexedDocIds.has(doc.id)) || [];

  if (unindexed.length > 0) {
    console.log(`\n⏳ NOT INDEXED (${unindexed.length} documents):`);
    unindexed.forEach(doc => {
      console.log(`  - ${doc.title} (${doc.document_type})`);
    });
  }
}

main().catch(console.error);

