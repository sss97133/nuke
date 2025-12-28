#!/usr/bin/env node
/**
 * Test LLM extraction directly to see results
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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('❌ Missing OPENAI_API_KEY');
  process.exit(1);
}

const listingUrl = process.argv[2] || 'https://carsandbids.com/auctions/r4M5pvy9/1967-chevrolet-corvette-convertible';

async function testLLMDirect() {
  try {
    console.log(`🧪 Testing LLM extraction directly on: ${listingUrl}\n`);

    // First, get the HTML from the extraction function
    const extractResponse = await fetch(`${SUPABASE_URL}/functions/v1/extract-premium-auction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        url: listingUrl,
        max_vehicles: 1,
        download_images: false,
        debug: true,
        return_html: true, // Try to get HTML back
      }),
    });

    let extractResult;
    try {
      extractResult = await extractResponse.json();
    } catch {
      // Response might be HTML, try text
      const htmlText = await extractResponse.text();
      extractResult = { html: htmlText };
    }
    
    if (!extractResult.html) {
      console.log('⚠️ No HTML returned. Trying direct fetch...\n');
      
      // Try fetching HTML directly
      const htmlResponse = await fetch(listingUrl);
      const html = await htmlResponse.text();
      
      if (html.length < 1000) {
        console.error('❌ HTML too short, extraction may have failed');
        return;
      }
      
      console.log(`📄 Got HTML (${html.length} chars), testing LLM extraction...\n`);
      
      // Test LLM extraction with simplified prompt
      const htmlSnippet = html.substring(0, 20000);
      
      const prompt = `Extract these vehicle fields from the HTML. Return JSON only:

- mileage: What is the vehicle mileage/odometer reading?
- color: What is the exterior color?
- transmission: What is the transmission type?
- engine_size: What is the engine size/description?
- vin: What is the VIN (17 characters)?

HTML:
${htmlSnippet}

Return JSON:
{
  "extracted_fields": {
    "mileage": 45000,
    "color": "Red",
    "transmission": "Manual",
    "engine_size": "5.7L V8",
    "vin": "194677S123456"
  }
}

Extract only fields that are clearly present. Use null for missing fields.`;

      const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      if (!llmResponse.ok) {
        const errorText = await llmResponse.text();
        console.error(`❌ LLM API error: ${llmResponse.status} - ${errorText}`);
        return;
      }

      const llmData = await llmResponse.json();
      const content = llmData.choices[0]?.message?.content;
      
      if (!content) {
        console.error('❌ LLM returned empty response');
        return;
      }

      console.log('✅ LLM Response:\n');
      console.log(content);
      console.log('\n');

      try {
        const result = JSON.parse(content);
        if (result.extracted_fields) {
          console.log('📊 Extracted Fields:');
          for (const [field, value] of Object.entries(result.extracted_fields)) {
            console.log(`   ${field}: ${value !== null ? value : 'N/A'}`);
          }
        }
      } catch (parseError) {
        console.error('❌ Failed to parse LLM response as JSON');
        console.error('Raw response:', content.substring(0, 500));
      }

    } else {
      console.log('✅ Got HTML from extraction function');
      console.log(`   Length: ${extractResult.html.length} chars`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testLLMDirect();

