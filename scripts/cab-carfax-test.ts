/**
 * Test Carfax data extraction
 * Uses Firecrawl to bypass Carfax's protection
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_KEY;
const TEST_CARFAX_URL = 'https://www.carfax.com/vehiclehistory/ar20/SG09Ar9xmXBlwFpppiW7hFqyn3hP1HyRmv_ZBSg4i4EMnsFftK7c0UecN0PJTZH_QBiilK4j5sJcAUWvHZMSt3YFGo002FqSLsYnvSpJ';

async function extractCarfax() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  CARFAX DATA EXTRACTION TEST');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (!FIRECRAWL_API_KEY) {
    console.log('❌ FIRECRAWL_API_KEY not found in environment');
    return;
  }

  console.log(`Fetching Carfax report via Firecrawl...`);
  console.log(`URL: ${TEST_CARFAX_URL.substring(0, 80)}...\n`);

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url: TEST_CARFAX_URL,
        formats: ['markdown', 'html'],
        onlyMainContent: false,
        waitFor: 5000,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.log('❌ Firecrawl error:', data.error || response.statusText);
      return;
    }

    console.log('✅ Firecrawl response received\n');

    const markdown = data.data?.markdown || '';
    const html = data.data?.html || '';

    console.log(`Markdown length: ${markdown.length} chars`);
    console.log(`HTML length: ${html.length} chars\n`);

    // Extract key Carfax data points
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  EXTRACTED CARFAX DATA');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    // VIN
    const vinMatch = markdown.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i) || html.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    console.log(`VIN: ${vinMatch ? vinMatch[1] : 'NOT FOUND'}`);

    // Accident/Damage
    const accidentFree = markdown.toLowerCase().includes('no accidents') || markdown.toLowerCase().includes('accident-free');
    const hasAccident = markdown.toLowerCase().includes('accident reported') || markdown.toLowerCase().includes('damage reported');
    console.log(`Accidents: ${accidentFree ? 'NO ACCIDENTS ✅' : hasAccident ? 'ACCIDENT REPORTED ⚠️' : 'UNKNOWN'}`);

    // Owners
    const ownersMatch = markdown.match(/(\d+)\s*(?:owner|owners)/i);
    console.log(`Owners: ${ownersMatch ? ownersMatch[1] : 'UNKNOWN'}`);

    // Title
    const titleClean = markdown.toLowerCase().includes('clean title');
    const titleSalvage = markdown.toLowerCase().includes('salvage') || markdown.toLowerCase().includes('rebuilt');
    console.log(`Title: ${titleClean ? 'CLEAN ✅' : titleSalvage ? 'SALVAGE/REBUILT ⚠️' : 'UNKNOWN'}`);

    // Service Records
    const serviceMatch = markdown.match(/(\d+)\s*service\s*records?/i);
    console.log(`Service Records: ${serviceMatch ? serviceMatch[1] : 'UNKNOWN'}`);

    // Odometer
    const odometerMatch = markdown.match(/last\s*(?:reported\s*)?(?:odometer|mileage)[:\s]*([0-9,]+)/i);
    console.log(`Last Odometer: ${odometerMatch ? odometerMatch[1] : 'UNKNOWN'}`);

    // Print raw markdown preview
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('  RAW MARKDOWN PREVIEW (first 2000 chars)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log(markdown.substring(0, 2000));

  } catch (error: any) {
    console.log('❌ Error:', error.message);
  }
}

extractCarfax();
