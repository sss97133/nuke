#!/usr/bin/env node
/**
 * Test LLM extraction on a specific listing
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const listingUrl = process.argv[2] || 'https://carsandbids.com/auctions/r4M5pvy9/1967-chevrolet-corvette-convertible';

async function testLLMExtraction() {
  try {
    console.log(`🧪 Testing LLM extraction on: ${listingUrl}\n`);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-premium-auction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        url: listingUrl,
        max_vehicles: 1,
        download_images: false, // Skip downloads for faster testing
        debug: true, // Enable debug logging
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Error:', result.error || result.message || 'Unknown error');
      console.error('Full response:', JSON.stringify(result, null, 2));
      return;
    }

    console.log('\n✅ Extraction complete!\n');
    console.log('📊 Results:');
    console.log(`   Vehicles extracted: ${result.extracted || 0}`);
    console.log(`   Vehicles updated: ${result.updated || 0}`);
    console.log(`   Images found: ${result.images_inserted || result.images?.length || 'N/A'}`);
    
    if (result.debug) {
      console.log('\n🔍 Debug Info:');
      console.log(JSON.stringify(result.debug, null, 2));
    }

    if (result.issues && result.issues.length > 0) {
      console.log(`\n⚠️  Issues (${result.issues.length}):`);
      result.issues.slice(0, 10).forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue}`);
      });
    }

    // Check if LLM extraction ran (look for LLM-related logs in issues or debug)
    const llmLogs = (result.issues || []).filter((i) => i.includes('LLM') || i.includes('extracted'));
    if (llmLogs.length > 0) {
      console.log('\n🤖 LLM Extraction Logs:');
      llmLogs.forEach((log) => console.log(`   ${log}`));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testLLMExtraction();

