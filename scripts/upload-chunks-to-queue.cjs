require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const text = fs.readFileSync('/tmp/lmc.txt', 'utf-8');
  const chunkSize = 15000;
  const catalogId = '1e88b411-1c39-4da6-b2a6-200d7fc1e3f7';
  
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push({
      catalog_id: catalogId,
      chunk_index: Math.floor(i / chunkSize),
      text_content: text.substring(i, i + chunkSize),
      status: 'pending'
    });
  }
  
  console.log(`Uploading ${chunks.length} chunks to queue...`);
  
  for (let i = 0; i < chunks.length; i += 50) {
    const batch = chunks.slice(i, i + 50);
    const { error } = await supabase.from('catalog_text_chunks').insert(batch);
    if (error) console.error('Error:', error.message);
    else console.log(`  Uploaded ${i + batch.length}/${chunks.length}`);
  }
  
  console.log('✅ All chunks uploaded to queue!');
}

main();

