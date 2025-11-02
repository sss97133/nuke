#!/usr/bin/env node
// Backfill smart-receipt-linker for all existing receipts
// Processes all vehicle_documents that are receipts/invoices and haven't been AI-processed yet

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillReceiptExtraction() {
  console.log('🤖 Starting receipt extraction backfill...\n');

  // 1. Find all receipts/invoices that haven't been processed
  const { data: documents, error } = await supabase
    .from('vehicle_documents')
    .select('id, vehicle_id, file_url, document_type, title, document_date, ai_processing_status')
    .in('document_type', ['receipt', 'invoice'])
    .or('ai_processing_status.is.null,ai_processing_status.eq.pending')
    .not('file_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100); // Process 100 at a time to avoid rate limits

  if (error) {
    console.error('❌ Error fetching documents:', error);
    process.exit(1);
  }

  if (!documents || documents.length === 0) {
    console.log('✅ No documents to process. All receipts are up to date!');
    return;
  }

  console.log(`📄 Found ${documents.length} documents to process\n`);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const errors = [];

  for (const doc of documents) {
    processed++;
    console.log(`[${processed}/${documents.length}] Processing ${doc.document_type}: ${doc.title || doc.id}`);
    console.log(`   Vehicle: ${doc.vehicle_id}`);
    console.log(`   URL: ${doc.file_url.substring(0, 60)}...`);

    try {
      // Mark as processing
      await supabase
        .from('vehicle_documents')
        .update({
          ai_processing_status: 'processing',
          ai_processing_started_at: new Date().toISOString()
        })
        .eq('id', doc.id);

      // Invoke smart-receipt-linker
      const { data, error: functionError } = await supabase.functions.invoke('smart-receipt-linker', {
        body: {
          documentId: doc.id,
          vehicleId: doc.vehicle_id,
          documentUrl: doc.file_url
        }
      });

      if (functionError) {
        throw new Error(`Function error: ${functionError.message}`);
      }

      if (!data || !data.success) {
        throw new Error(`Function returned unsuccessful: ${JSON.stringify(data)}`);
      }

      // Mark as completed
      await supabase
        .from('vehicle_documents')
        .update({
          ai_processing_status: 'completed',
          ai_processing_completed_at: new Date().toISOString(),
          ai_extraction_confidence: data.confidence || null
        })
        .eq('id', doc.id);

      console.log(`   ✅ Success: ${data.extractedItems || 0} items, ${data.linkedImages || 0} images, ${Math.round((data.confidence || 0) * 100)}% confidence\n`);
      succeeded++;

      // Rate limit: wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}\n`);
      failed++;
      errors.push({ doc: doc.id, error: err.message });

      // Mark as failed
      await supabase
        .from('vehicle_documents')
        .update({
          ai_processing_status: 'failed',
          ai_processing_completed_at: new Date().toISOString()
        })
        .eq('id', doc.id);
    }
  }

  console.log('\n📊 Backfill Summary:');
  console.log(`   Total processed: ${processed}`);
  console.log(`   ✅ Succeeded: ${succeeded}`);
  console.log(`   ❌ Failed: ${failed}`);

  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    errors.forEach(({ doc, error }) => {
      console.log(`   ${doc}: ${error}`);
    });
  }

  console.log('\n✨ Backfill complete!');
}

backfillReceiptExtraction().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

