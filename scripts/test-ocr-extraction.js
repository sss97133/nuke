import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const workOrderImages = [
  'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/organization-data/f26e26f9-78d6-4f73-820b-fa9015d9242b/images/1762116111057_ydjbr2f0osi.jpeg',
  'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/organization-data/f26e26f9-78d6-4f73-820b-fa9015d9242b/images/1762116157134_2iyetjvt1dq.jpeg',
  'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/organization-data/f26e26f9-78d6-4f73-820b-fa9015d9242b/images/1762116179293_a2f45fg92tr.jpeg'
];

console.log('🔍 Extracting work order data with AI OCR...\n');

for (const imageUrl of workOrderImages) {
  console.log(`📄 Processing: ${imageUrl.split('/').pop()}`);
  
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/extract-work-order-ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_url: imageUrl })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('   ✅ Extracted:');
      console.log(`      Total: ${result.data.currency || 'EUR'} ${result.data.total || 0}`);
      console.log(`      Labor: ${result.data.labor_total || 0}`);
      console.log(`      Parts: ${result.data.parts_total || 0}`);
      console.log(`      Date: ${result.data.service_date || 'Unknown'}`);
      console.log(`      Confidence: ${result.data.extraction_confidence}%`);
      console.log('');
    } else {
      console.log(`   ❌ Failed: ${result.error}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
  }
}
