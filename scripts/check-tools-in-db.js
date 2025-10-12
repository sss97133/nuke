/**
 * Check what tools are actually in the database
 * Quick diagnostic without calling any APIs
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../nuke_frontend/.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTools(userId) {
  console.log('=== CHECKING TOOLS IN DATABASE ===\n');
  
  // Get receipt info
  const { data: receipts } = await supabase
    .from('tool_receipt_documents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (receipts && receipts.length > 0) {
    console.log('📄 Receipts found:', receipts.length);
    receipts.forEach(r => {
      console.log(`\n  Receipt: ${r.original_filename}`);
      console.log(`  - Supplier: ${r.supplier_name || 'Unknown'}`);
      console.log(`  - Status: ${r.processing_status}`);
      console.log(`  - Tools extracted: ${r.tools_extracted || 0}`);
      console.log(`  - Tools saved: ${r.tools_saved || 0}`);
      console.log(`  - Date: ${new Date(r.created_at).toLocaleString()}`);
    });
  } else {
    console.log('📄 No receipts found');
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Get actual tools in database
  const { data: tools, error } = await supabase
    .from('user_tools')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching tools:', error);
    return;
  }
  
  console.log(`🔧 TOOLS IN DATABASE: ${tools.length}\n`);
  
  if (tools.length > 0) {
    // Group by receipt
    const byReceipt = tools.reduce((acc, tool) => {
      const receiptId = tool.receipt_document_id || 'no-receipt';
      if (!acc[receiptId]) acc[receiptId] = [];
      acc[receiptId].push(tool);
      return acc;
    }, {});
    
    Object.entries(byReceipt).forEach(([receiptId, toolList]) => {
      console.log(`From receipt ${receiptId.substring(0, 8)}...:`);
      console.log(`  Total: ${toolList.length} tools`);
      console.log(`  Total value: $${toolList.reduce((sum, t) => sum + (t.total_spent || 0), 0).toFixed(2)}`);
      console.log(`\n  Sample tools:`);
      toolList.slice(0, 5).forEach(t => {
        console.log(`    - ${t.part_number || 'NO-PART'}: ${t.description || t.name} - $${(t.total_spent || 0).toFixed(2)}`);
      });
      if (toolList.length > 5) {
        console.log(`    ... and ${toolList.length - 5} more`);
      }
      console.log('');
    });
    
    // Show brand breakdown
    const byBrand = tools.reduce((acc, tool) => {
      const brand = tool.brand_name || 'Unknown';
      acc[brand] = (acc[brand] || 0) + 1;
      return acc;
    }, {});
    
    console.log('📊 By Brand:');
    Object.entries(byBrand)
      .sort(([,a], [,b]) => b - a)
      .forEach(([brand, count]) => {
        console.log(`  ${brand}: ${count} tools`);
      });
  } else {
    console.log('No tools found in database');
  }
}

const userId = process.argv[2];

if (!userId) {
  console.error('Usage: node check-tools-in-db.js <user_id>');
  process.exit(1);
}

checkTools(userId).then(() => process.exit(0));
