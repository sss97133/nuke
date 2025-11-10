import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;

const imageUrl = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/organization-data/f26e26f9-78d6-4f73-820b-fa9015d9242b/images/1762116111057_ydjbr2f0osi.jpeg';

console.log('🔍 Testing AI extraction on ONE FBM work order...\n');
console.log('💰 Cost: ~$0.05 (5 cents)\n');

const response = await fetch(`${supabaseUrl}/functions/v1/extract-work-order-ocr`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ image_url: imageUrl })
});

const result = await response.json();

if (result.success) {
  const d = result.data;
  console.log('✅ EXTRACTED DATA:\n');
  console.log(`Work Order #: ${d.work_order_number || 'N/A'}`);
  console.log(`Date: ${d.service_date || 'N/A'}`);
  console.log(`Vehicle: ${d.vehicle?.year || ''} ${d.vehicle?.make || ''} ${d.vehicle?.model || ''}`);
  console.log(`\n📋 LINE ITEMS:`);
  
  d.line_items?.forEach((item, i) => {
    console.log(`${i + 1}. ${item.description}`);
    console.log(`   ${item.hours || 0}H @ ${d.currency || 'EUR'}${item.rate || 0}/hr = ${d.currency || 'EUR'}${item.amount || 0}`);
  });
  
  console.log(`\n💵 TOTALS:`);
  console.log(`Labor: ${d.currency}${d.labor_total || 0}`);
  console.log(`Parts: ${d.currency}${d.parts_total || 0}`);
  console.log(`TOTAL: ${d.currency}${d.total || 0}`);
  
  console.log(`\n🎯 CONTRACTOR PAY (at €32.50/hr):`);
  const totalHours = d.line_items?.reduce((sum, item) => sum + (item.hours || 0), 0) || 0;
  const contractorPay = totalHours * 32.50;
  console.log(`${totalHours} hours × €32.50 = €${contractorPay.toFixed(2)}`);
  
  console.log(`\n✅ Confidence: ${d.extraction_confidence}%`);
} else {
  console.error('❌ Error:', result.error);
}
