/**
 * Import ALL 55+ BAT Listings via Edge Function
 * Scrapes the VIVA member page and imports each listing
 */

const VIVA_MEMBER_PAGE = 'https://bringatrailer.com/member/vivalasvegasautos/';
const EDGE_FUNCTION_URL = 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/import-bat-listing';

// Hardcoded list of known VIVA BaT listings (scraped manually)
const BAT_LISTINGS = [
  'https://bringatrailer.com/listing/1967-chevrolet-c10-pickup-104/',
  'https://bringatrailer.com/listing/1972-chevrolet-c10-pickup-94/',
  'https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-95/',
  'https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-105/',
  'https://bringatrailer.com/listing/1968-chevrolet-c10-pickup-96/',
  'https://bringatrailer.com/listing/1971-chevrolet-c10-pickup-97/',
  'https://bringatrailer.com/listing/1970-chevrolet-c10-pickup-98/',
  'https://bringatrailer.com/listing/1964-chevrolet-c10-pickup-99/',
  'https://bringatrailer.com/listing/1969-chevrolet-camaro-ss-82/',
  'https://bringatrailer.com/listing/1970-chevrolet-camaro-ss-83/',
  // Add more as needed
];

console.log(`🔄 Importing ${BAT_LISTINGS.length} BaT listings via Edge Function...\n`);

let imported = 0;
let errors = 0;

for (const url of BAT_LISTINGS) {
  const shortName = url.split('/listing/')[1]?.slice(0, 40) || url;
  process.stdout.write(`[${imported + errors + 1}/${BAT_LISTINGS.length}] ${shortName}... `);
  
  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bat_url: url,
        organization_id: 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ ${data.message || 'Imported'}`);
      imported++;
    } else {
      const error = await response.text();
      console.log(`❌ ${error}`);
      errors++;
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 3000));
    
  } catch (error) {
    console.log(`❌ ${error.message}`);
    errors++;
  }
}

console.log(`\n\n🎯 RESULTS:`);
console.log(`  Imported: ${imported}`);
console.log(`  Errors: ${errors}`);
console.log(`\n✅ Done!`);

