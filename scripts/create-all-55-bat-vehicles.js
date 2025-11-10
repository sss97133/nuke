/**
 * CREATE ALL 55 BAT VEHICLE PROFILES
 * Uses the complete list of URLs we scraped earlier
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// Complete list of 55 URLs from earlier scrape
const ALL_55_URLS = [
  'https://bringatrailer.com/listing/1987-gmc-suburban-13/',
  'https://bringatrailer.com/listing/1993-chevrolet-corvette-zr-1-41/',
  'https://bringatrailer.com/listing/1978-chevrolet-k20-pickup-9/',
  'https://bringatrailer.com/listing/2023-speed-utv-el-jefe-2/',
  'https://bringatrailer.com/listing/2023-winnebago-sprinter-rv-conversion-4/',
  'https://bringatrailer.com/listing/2019-thor-motor-coach-hurricane-29m/',
  'https://bringatrailer.com/listing/2023-speed-utv-el-jefe/',
  'https://bringatrailer.com/listing/1958-citroen-2cv-4/',
  'https://bringatrailer.com/listing/2010-bmw-135i-convertible-2/',
  'https://bringatrailer.com/listing/1985-chevrolet-suburban-11/',
  'https://bringatrailer.com/listing/1965-chevrolet-impala-ss-41/',
  'https://bringatrailer.com/listing/2004-ford-f-350-26/',
  'https://bringatrailer.com/listing/2023-speed-utv-el-jefe-le/',
  'https://bringatrailer.com/listing/1984-citroen-2cv6/',
  'https://bringatrailer.com/listing/1970-ford-ranchero-18/',
  'https://bringatrailer.com/listing/2023-ford-f-150-raptor-71/',
  'https://bringatrailer.com/listing/2023-ford-f-150-raptor-70/',
  'https://bringatrailer.com/listing/2023-ford-f-150-raptor-69/',
  'https://bringatrailer.com/listing/1980-chevrolet-k30-pickup-2-2/',
  'https://bringatrailer.com/listing/2022-ford-f-150-raptor-36/',
  'https://bringatrailer.com/listing/2001-gmc-yukon-xl-11/',
  'https://bringatrailer.com/listing/1983-mercedes-benz-240d-74/',
  'https://bringatrailer.com/listing/1976-chevrolet-c20-pickup-5/',
  'https://bringatrailer.com/listing/1932-ford-highboy-5/',
  'https://bringatrailer.com/listing/2003-mercedes-benz-s55-amg-28/',
  'https://bringatrailer.com/listing/1980-chevrolet-k30-pickup-2/',
  'https://bringatrailer.com/listing/1972-chevrolet-k10-pickup-6/',
  'https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-105/',
  'https://bringatrailer.com/listing/1988-jeep-wrangler-32/',
  'https://bringatrailer.com/listing/1968-porsche-911-35/',
  'https://bringatrailer.com/listing/1946-mercury-eight-6/',
  'https://bringatrailer.com/listing/1979-gmc-k1500/',
  'https://bringatrailer.com/listing/2008-bentley-continental-gtc-27/',
  'https://bringatrailer.com/listing/2001-gmc-yukon-xl-2/',
  'https://bringatrailer.com/listing/1989-cadillac-eldorado-biarritz-6/',
  'https://bringatrailer.com/listing/2021-ford-mustang-shelby-gt500-48/',
  'https://bringatrailer.com/listing/1996-gmc-suburban-slt-2500-4x4-7/',
  'https://bringatrailer.com/listing/1999-chevrolet-suburban-55/',
  'https://bringatrailer.com/listing/no-reserve-1995-ford-f-150-xlt-supercab-4x4-5-8l/',
  'https://bringatrailer.com/listing/2020-subaru-wrx-sti-15/',
  'https://bringatrailer.com/listing/1991-ford-f-350-5/',
  'https://bringatrailer.com/listing/1999-porsche-911-carrera-cabriolet-49/',
  'https://bringatrailer.com/listing/2008-lamborghini-gallardo-36/',
  'https://bringatrailer.com/listing/1989-chrysler-tc-18/',
  'https://bringatrailer.com/listing/1987-gmc-suburban-3/',
  'https://bringatrailer.com/listing/1977-ford-f-150-ranger-17/',
  'https://bringatrailer.com/listing/1985-subaru-brat-2/',
  'https://bringatrailer.com/listing/1964-chevrolet-corvette-16/',
  'https://bringatrailer.com/listing/1982-chrysler-le-baron-2/',
  'https://bringatrailer.com/listing/2005-bmw-m3-convertible-18/',
  'https://bringatrailer.com/listing/1983-porsche-911sc-targa-11/',
  'https://bringatrailer.com/listing/1984-mercedes-benz-380sl-11/',
  'https://bringatrailer.com/listing/1986-jeep-grand-wagoneer-2/',
  'https://bringatrailer.com/listing/1985-pontiac-fiero-gt/',
  'https://bringatrailer.com/listing/1966-ford-mustang-fastback-gt350r-gt350r2-tribute/'
];

console.log(`📋 Processing ${ALL_55_URLS.length} BaT listings...\n`);

let created = 0;
let skipped = 0;
let errors = 0;

for (let i = 0; i < ALL_55_URLS.length; i++) {
  const url = ALL_55_URLS[i];
  const shortName = url.split('/listing/')[1]?.slice(0, 35) || url;
  
  process.stdout.write(`[${i + 1}/${ALL_55_URLS.length}] ${shortName}... `);
  
  try {
    // Call the import-bat-listing edge function
    const response = await fetch(`${supabaseUrl}/functions/v1/import-bat-listing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ 
        batUrl: url,
        organizationId: VIVA_ORG_ID
      })
    });

    const result = await response.json();
    
    if (result.error) {
      console.log(`❌ ${result.error}`);
      errors++;
    } else if (result.action === 'created') {
      console.log(`✅ CREATED`);
      created++;
    } else {
      console.log(`⏭️  EXISTS`);
      skipped++;
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
  } catch (error) {
    console.log(`❌ ${error.message}`);
    errors++;
  }
}

console.log(`\n\n🎯 FINAL RESULTS:`);
console.log(`─────────────────────────────────────`);
console.log(`New vehicles created: ${created}`);
console.log(`Existing vehicles: ${skipped}`);
console.log(`Errors: ${errors}`);
console.log(`Total processed: ${created + skipped}`);
console.log(`\n✅ All 55 BaT listings processed!`);

