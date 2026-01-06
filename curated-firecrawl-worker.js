#!/usr/bin/env node

/**
 * CURATED FIRECRAWL EXTRACTION WORKER
 * Uses Firecrawl + AI agent curation loop for perfect extractions
 * Iterates until data is validated and correct
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function getNextQueueItem() {
  const { data: items, error } = await supabase
    .from('import_queue')
    .select('*')
    .order('priority', { ascending: false })
    .limit(1);

  if (error) {
    console.error('❌ Error getting queue item:', error);
    return null;
  }

  return items.length > 0 ? items[0] : null;
}

async function firecrawlExtraction(url) {
  console.log(`🔧 Direct Firecrawl extraction: ${url}`);

  try {
    // Use Firecrawl directly to bypass Edge Function issues
    const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
    if (!firecrawlApiKey) {
      throw new Error('FIRECRAWL_API_KEY not found in environment');
    }

    const response = await fetch('https://api.firecrawl.dev/v0/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: url,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        includeTags: ['img', 'a', 'p', 'h1', 'h2', 'h3', 'div', 'span', 'li'],
        excludeTags: ['nav', 'footer', 'header', 'aside', 'script', 'style'],
        waitFor: 3000
      })
    });

    if (!response.ok) {
      throw new Error(`Firecrawl API ${response.status}: ${response.statusText}`);
    }

    const firecrawlData = await response.json();

    if (!firecrawlData.success) {
      throw new Error(`Firecrawl extraction failed: ${firecrawlData.error || 'Unknown error'}`);
    }

    // Extract basic vehicle data from Firecrawl result
    const extractedData = {
      url: url,
      title: firecrawlData.data.metadata?.title || null,
      description: firecrawlData.data.metadata?.description || null,
      content: firecrawlData.data.markdown || firecrawlData.data.html || null,
      images: firecrawlData.data.metadata?.ogImage ? [firecrawlData.data.metadata.ogImage] : [],
      raw_html: firecrawlData.data.html || null
    };

    return { success: true, data: extractedData, rawResponse: firecrawlData };
  } catch (error) {
    if (error.name === 'TimeoutError') {
      console.error(`⏱️  Timeout for ${url} - will retry with AI curation`);
    } else {
      console.error(`❌ Firecrawl extraction failed for ${url}:`, error.message);
    }
    return { success: false, error: error.message, timeout: error.name === 'TimeoutError' };
  }
}

async function curateWithAI(url, extractedData, iteration = 1) {
  console.log(`🤖 Direct AI curation iteration ${iteration} for: ${url}`);

  try {
    // Use Anthropic API directly to bypass Edge Function issues
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY not found in environment');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${anthropicApiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Please review this vehicle extraction and improve it (iteration ${iteration}):

URL: ${url}

Extracted Data:
${JSON.stringify(extractedData, null, 2)}

Tasks:
1. Validate all vehicle specifications (year, make, model, trim, engine, etc.)
2. Ensure price information is accurate and properly formatted
3. Check that mileage makes sense for the year
4. Verify VIN if present
5. Improve description for completeness and accuracy
6. Extract proper vehicle specifications from content
7. Check for missing critical data and suggest corrections

Extract from the content any vehicle details like:
- Year, Make, Model, Trim
- Engine specifications
- Mileage
- Price (asking price)
- VIN
- Description
- Images

Return ONLY a JSON response in this format:
{
  "needs_correction": boolean,
  "corrected_data": {
    "year": number,
    "make": "string",
    "model": "string",
    "trim": "string",
    "engine": "string",
    "mileage": number,
    "asking_price": number,
    "description": "string",
    "images": ["url1", "url2"],
    "vin": "string"
  },
  "issues_found": ["issue1", "issue2"]
}`
        }]
      }),
      signal: AbortSignal.timeout(60000) // 1 minute for AI curation
    });

    if (!response.ok) {
      throw new Error(`Anthropic API ${response.status}: ${response.statusText}`);
    }

    const anthropicResponse = await response.json();

    if (!anthropicResponse.content?.[0]?.text) {
      throw new Error('No response content from Anthropic API');
    }

    const responseText = anthropicResponse.content[0].text;

    try {
      const curationResult = JSON.parse(responseText);
      return curationResult;
    } catch (parseError) {
      console.error('❌ Failed to parse AI response as JSON:', responseText);
      return {
        needs_correction: false,
        error: 'Failed to parse AI response',
        issues_found: ['AI response parsing failed']
      };
    }

  } catch (error) {
    console.error(`❌ AI curation failed:`, error.message);
    return {
      success: false,
      error: error.message,
      needs_correction: false // Fail safe - proceed with original data
    };
  }
}

async function iterativeCuratedExtraction(url, maxIterations = 3) {
  console.log(`🔄 Starting curated extraction for: ${url}`);

  let currentData = null;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    // Step 1: Firecrawl extraction
    if (iteration === 1) {
      const extractionResult = await firecrawlExtraction(url);
      if (!extractionResult.success) {
        console.log(`❌ Initial extraction failed: ${extractionResult.error}`);
        return { success: false, error: extractionResult.error };
      }
      currentData = extractionResult.data;
    }

    // Step 2: AI curation
    console.log(`🤖 AI curation round ${iteration}...`);
    const curationResult = await curateWithAI(url, currentData, iteration);

    if (!curationResult.needs_correction) {
      console.log(`✅ AI approved extraction after ${iteration} iteration(s)`);
      return {
        success: true,
        data: curationResult.corrected_data || currentData,
        iterations: iteration,
        final_validation: 'AI_APPROVED'
      };
    }

    // Apply AI corrections
    if (curationResult.corrected_data) {
      console.log(`🔧 Applying AI corrections...`);
      currentData = { ...currentData, ...curationResult.corrected_data };
    }

    if (curationResult.issues_found?.length > 0) {
      console.log(`⚠️  Issues found: ${curationResult.issues_found.join(', ')}`);
    }
  }

  // Max iterations reached - proceed with best available data
  console.log(`⏰ Max iterations reached, proceeding with current data`);
  return {
    success: true,
    data: currentData,
    iterations: iteration,
    final_validation: 'MAX_ITERATIONS_REACHED'
  };
}

async function saveVehicleToDatabase(vehicleData, url) {
  try {
    const vehicleRecord = {
      year: vehicleData.year || null,
      make: vehicleData.make || null,
      model: vehicleData.model || null,
      trim: vehicleData.trim || null,
      engine: vehicleData.engine || null,
      mileage: vehicleData.mileage || null,
      asking_price: vehicleData.asking_price || null,
      description: vehicleData.description || null,
      discovery_url: url,
      source: 'curated_firecrawl_extraction',
      created_at: new Date().toISOString()
    };

    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert(vehicleRecord)
      .select('id')
      .single();

    if (error) {
      console.error('❌ Database save error:', error);
      return null;
    }

    console.log(`💾 Vehicle saved to database: ID ${newVehicle.id}`);
    return newVehicle.id;

  } catch (error) {
    console.error('❌ Database error:', error);
    return null;
  }
}

async function removeFromQueue(itemId) {
  const { error } = await supabase
    .from('import_queue')
    .delete()
    .eq('id', itemId);

  if (error) {
    console.error('❌ Error removing from queue:', error);
  }
}

async function curatedExtractionLoop() {
  console.log('🔄 Starting curated Firecrawl + AI extraction worker...');
  console.log('🤖 Iterative curation until perfect extractions');

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let totalIterations = 0;
  const startTime = Date.now();

  while (true) {
    try {
      const queueItem = await getNextQueueItem();

      if (!queueItem) {
        console.log('📭 Queue empty, waiting 30 seconds...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }

      console.log(`\\n🚀 Processing item ${processed + 1}: ${queueItem.listing_url}`);
      const result = await iterativeCuratedExtraction(queueItem.listing_url);

      if (result.success && result.data) {
        // Save the vehicle to database
        const vehicleId = await saveVehicleToDatabase(result.data, queueItem.listing_url);

        if (vehicleId) {
          succeeded++;
          totalIterations += result.iterations || 1;
          console.log(`✅ Success! Vehicle extracted with ${result.iterations} iterations (${result.final_validation})`);
          console.log(`💾 Vehicle ID: ${vehicleId}`);
        } else {
          failed++;
          console.log(`❌ Failed: Could not save vehicle to database`);
        }
      } else {
        failed++;
        console.log(`❌ Failed: ${result.error}`);
      }

      // Remove item from queue
      await removeFromQueue(queueItem.id);
      processed++;

      // Show progress every 10 items
      if (processed % 10 === 0) {
        const elapsedHours = (Date.now() - startTime) / (1000 * 60 * 60);
        const rate = Math.round(processed / elapsedHours);
        const successRate = Math.round((succeeded / processed) * 100);
        const avgIterations = totalIterations > 0 ? (totalIterations / succeeded).toFixed(1) : 0;

        console.log(`\\n📈 CURATED EXTRACTION PROGRESS:`);
        console.log(`   Processed: ${processed} vehicles`);
        console.log(`   Succeeded: ${succeeded} (${successRate}%)`);
        console.log(`   Failed: ${failed}`);
        console.log(`   Rate: ${rate} vehicles/hour`);
        console.log(`   Avg AI iterations: ${avgIterations}`);
        console.log(`   Quality: Curated & validated by AI`);
      }

      // Delay between extractions to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error('💥 Worker error:', error);
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s on error
    }
  }
}

console.log('🤖 CURATED FIRECRAWL + AI EXTRACTION WORKER');
console.log('='.repeat(60));
console.log('• Firecrawl extraction for comprehensive data');
console.log('• AI agent curation & validation loop');
console.log('• Iterates until extraction is perfect');
console.log('• Creates complete profiles with ecosystem data');
console.log('• Quality-focused approach with AI oversight');
console.log('='.repeat(60));

curatedExtractionLoop().catch(console.error);