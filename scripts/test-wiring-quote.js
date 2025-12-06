/**
 * TEST WIRING QUOTE GENERATION
 * 
 * Tests the wiring quote generator with Motec and ProWire products
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
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testQuote() {
  console.log('🧪 TESTING WIRING QUOTE GENERATION');
  console.log('='.repeat(70));
  console.log('');
  
  // Test 1: Quote with Motec ECUs
  console.log('Test 1: Motec ECU Quote');
  console.log('   Including: ECUs, Software, Displays');
  console.log('');
  
  const { data: motecQuote, error: motecError } = await supabase.functions.invoke('generate-wiring-quote', {
    body: {
      suppliers: ['Motec'],
      categories: ['ECU Kits', 'Software', 'Displays'],
      include_labor: true,
      labor_rate: 125.00
    }
  });
  
  if (motecError) {
    console.error('❌ Error:', motecError);
  } else if (motecQuote?.quote) {
    const q = motecQuote.quote;
    console.log(`✅ Generated quote with ${q.parts.length} parts`);
    console.log(`   Parts with prices: ${q.pricing.parts_with_prices}`);
    console.log(`   Parts requiring quote: ${q.pricing.parts_quote_required}`);
    console.log(`   Parts subtotal: $${q.pricing.parts_subtotal.toFixed(2)}`);
    console.log(`   Labor: ${q.pricing.labor_hours} hours @ $${q.pricing.labor_rate}/hr = $${q.pricing.labor_total.toFixed(2)}`);
    console.log(`   Grand total: $${q.pricing.grand_total.toFixed(2)}`);
    console.log('');
    console.log('   Suppliers:');
    q.supplier_breakdown.forEach(s => {
      console.log(`     - ${s.supplier}: ${s.items} items, $${s.subtotal.toFixed(2)}`);
      if (s.quote_required_count > 0) {
        console.log(`       (${s.quote_required_count} items require quote)`);
      }
    });
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('');
  
  // Test 2: Complete wiring system (Motec + ProWire)
  console.log('Test 2: Complete Wiring System Quote');
  console.log('   Including: Motec ECUs + ProWire Components');
  console.log('');
  
  const { data: fullQuote, error: fullError } = await supabase.functions.invoke('generate-wiring-quote', {
    body: {
      suppliers: ['Motec', 'ProWire'],
      include_labor: true,
      labor_rate: 125.00
    }
  });
  
  if (fullError) {
    console.error('❌ Error:', fullError);
  } else if (fullQuote?.quote) {
    const q = fullQuote.quote;
    console.log(`✅ Generated complete wiring system quote`);
    console.log(`   Total parts: ${q.parts.length}`);
    console.log(`   Parts with prices: ${q.pricing.parts_with_prices}`);
    console.log(`   Parts requiring quote: ${q.pricing.parts_quote_required}`);
    console.log(`   Parts subtotal: $${q.pricing.parts_subtotal.toFixed(2)}`);
    console.log(`   Labor: ${q.pricing.labor_hours} hours @ $${q.pricing.labor_rate}/hr = $${q.pricing.labor_total.toFixed(2)}`);
    console.log(`   Grand total: $${q.pricing.grand_total.toFixed(2)}`);
    console.log('');
    console.log('   Summary:');
    console.log(`     - Complete pricing: ${q.summary.has_complete_pricing ? 'Yes' : 'No'}`);
    console.log(`     - Suppliers: ${q.summary.suppliers.join(', ')}`);
    console.log(`     - Categories: ${q.summary.categories.slice(0, 5).join(', ')}${q.summary.categories.length > 5 ? '...' : ''}`);
    console.log('');
    console.log('   Supplier breakdown:');
    q.supplier_breakdown.forEach(s => {
      console.log(`     - ${s.supplier}: ${s.items} items, $${s.subtotal.toFixed(2)}`);
      if (s.quote_required_count > 0) {
        console.log(`       ⚠️  ${s.quote_required_count} items require quote`);
      }
    });
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('✅ Quote generation test complete!');
  console.log('');
  console.log('The system can now generate quotes even when some products');
  console.log('don\'t have prices (marks them as "quote required").');
}

testQuote().catch(console.error);

