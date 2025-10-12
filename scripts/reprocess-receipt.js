/**
 * Reprocess existing receipt with improved Claude parser
 * Fetches receipt from storage and re-runs AI extraction
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { ClaudeReceiptParser } from '../nuke_frontend/src/services/claudeReceiptParser.ts';
import { ProfessionalToolsService } from '../nuke_frontend/src/services/professionalToolsService.ts';
import fs from 'fs';
import path from 'path';

// Load environment variables
config({ path: '../nuke_frontend/.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function reprocessReceipt(userId) {
  try {
    console.log('Fetching latest receipt for user:', userId);
    
    // Get the most recent receipt document
    const { data: receipt, error: fetchError } = await supabase
      .from('tool_receipt_documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (fetchError || !receipt) {
      console.error('Failed to fetch receipt:', fetchError);
      return;
    }
    
    console.log('Found receipt:', {
      id: receipt.id,
      filename: receipt.original_filename,
      storage_path: receipt.storage_path,
      supplier: receipt.supplier_name,
      current_status: receipt.processing_status,
      tools_extracted: receipt.tools_extracted,
      tools_saved: receipt.tools_saved
    });
    
    // Download the file from storage
    console.log('\nDownloading receipt from storage...');
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('vehicle-data')
      .download(receipt.storage_path);
    
    if (downloadError) {
      console.error('Failed to download receipt:', downloadError);
      return;
    }
    
    console.log('Downloaded file:', fileData.type, fileData.size, 'bytes');
    
    // Update status to processing
    await supabase
      .from('tool_receipt_documents')
      .update({ processing_status: 'processing' })
      .eq('id', receipt.id);
    
    // Reprocess with improved parser
    console.log('\nReprocessing with improved Claude parser...');
    const parseResult = await ProfessionalToolsService.parseReceipt('', fileData);
    
    console.log('\nParse Results:');
    console.log('- Success:', parseResult.success);
    console.log('- Tools found:', parseResult.toolsImported);
    console.log('- Errors:', parseResult.errors.length);
    
    if (parseResult.errors.length > 0) {
      console.log('\nErrors:');
      parseResult.errors.forEach(err => console.log('  -', err));
    }
    
    if (parseResult.success && parseResult.tools.length > 0) {
      console.log('\nSample tools extracted:');
      parseResult.tools.slice(0, 5).forEach(tool => {
        console.log(`  - ${tool.part_number}: ${tool.name} - $${tool.purchase_price}`);
      });
      
      if (parseResult.tools.length > 5) {
        console.log(`  ... and ${parseResult.tools.length - 5} more`);
      }
      
      // Delete old tools from this receipt
      console.log('\nDeleting old tools from this receipt...');
      const { error: deleteError } = await supabase
        .from('user_tools')
        .delete()
        .eq('receipt_document_id', receipt.id);
      
      if (deleteError) {
        console.error('Failed to delete old tools:', deleteError);
      } else {
        console.log('Old tools deleted successfully');
      }
      
      // Save new tools
      console.log('\nSaving new tools to database...');
      await ProfessionalToolsService.saveToolsToDatabase(
        userId,
        parseResult.tools,
        receipt.id
      );
      
      // Update receipt status
      await ProfessionalToolsService.updateReceiptStatus(
        receipt.id,
        'completed',
        parseResult.tools.length,
        parseResult.tools.length,
        parseResult.errors
      );
      
      console.log('\n✅ Reprocessing complete!');
      console.log(`Imported ${parseResult.tools.length} tools from receipt`);
    } else {
      // Update with failed status
      await ProfessionalToolsService.updateReceiptStatus(
        receipt.id,
        'failed',
        0,
        0,
        parseResult.errors
      );
      
      console.log('\n❌ Reprocessing failed - no tools extracted');
    }
    
  } catch (error) {
    console.error('Reprocessing error:', error);
    throw error;
  }
}

// Get user ID from command line
const userId = process.argv[2];

if (!userId) {
  console.error('Usage: node reprocess-receipt.js <user_id>');
  process.exit(1);
}

reprocessReceipt(userId)
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
