/**
 * TEST WIRING QUERY
 * 
 * Tests natural language query: "I need a motec wiring for my 77 blazer"
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

async function testQuery() {
  console.log('🧪 TESTING NATURAL LANGUAGE WIRING QUERY');
  console.log('='.repeat(70));
  console.log('');
  console.log('Query: "I need a motec wiring for my 77 blazer"');
  console.log('');
  
  const { data, error } = await supabase.functions.invoke('query-wiring-needs', {
    body: {
      query: 'I need a motec wiring for my 77 blazer',
      year: 1977,
      make: 'Chevrolet',
      model: 'Blazer'
    }
  });
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  if (data.error) {
    console.error('❌ Function error:', data.error);
    return;
  }
  
  console.log('✅ Query processed successfully!');
  console.log('');
  console.log('='.repeat(70));
  console.log('📋 RESPONSE');
  console.log('='.repeat(70));
  console.log('');
  
  if (data.vehicle) {
    console.log(`🚗 Vehicle: ${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`);
  }
  
  if (data.parsed_intent) {
    console.log(`📝 Intent: ${data.parsed_intent.intent}`);
    console.log(`   Needs:`, data.parsed_intent.needs);
  }
  
  console.log('');
  console.log(`📦 Products Found: ${data.products_found}`);
  
  if (data.recommendations && data.recommendations.length > 0) {
    console.log('');
    console.log('💡 Recommendations:');
    data.recommendations.forEach((rec, i) => {
      console.log(`   ${i + 1}. ${rec.name || rec.part_number}`);
      if (rec.reason) console.log(`      Reason: ${rec.reason}`);
      if (rec.required) console.log(`      ⭐ Required`);
    });
  }
  
  if (data.system_description) {
    console.log('');
    console.log('📖 System Description:');
    console.log(`   ${data.system_description}`);
  }
  
  if (data.quote) {
    console.log('');
    console.log('💰 Quote Generated:');
    console.log(`   Parts: ${data.quote.parts.length} items`);
    console.log(`   Parts subtotal: $${data.quote.pricing.parts_subtotal.toFixed(2)}`);
    console.log(`   Parts with prices: ${data.quote.pricing.parts_with_prices}`);
    console.log(`   Parts requiring quote: ${data.quote.pricing.parts_quote_required}`);
    console.log(`   Labor: ${data.quote.pricing.labor_hours} hours @ $${data.quote.pricing.labor_rate}/hr = $${data.quote.pricing.labor_total.toFixed(2)}`);
    console.log(`   Grand total: $${data.quote.pricing.grand_total.toFixed(2)}`);
    
    if (data.quote.supplier_breakdown) {
      console.log('');
      console.log('   Supplier Breakdown:');
      data.quote.supplier_breakdown.forEach(s => {
        console.log(`     - ${s.supplier}: ${s.items} items, $${s.subtotal.toFixed(2)}`);
        if (s.quote_required_count > 0) {
          console.log(`       ⚠️  ${s.quote_required_count} items require quote`);
        }
      });
    }
  }
  
  if (data.next_steps) {
    console.log('');
    console.log('🎯 Next Steps:');
    data.next_steps.forEach((step, i) => {
      console.log(`   ${i + 1}. ${step}`);
    });
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('✅ Test complete!');
  console.log('');
  console.log('The system can now handle natural language queries like:');
  console.log('  - "I need a motec wiring for my 77 blazer"');
  console.log('  - "What wiring do I need for a 1977 Blazer with Motec ECU?"');
  console.log('  - "Quote me a complete wiring system for my 77 Chevy"');
}

testQuery().catch(console.error);

