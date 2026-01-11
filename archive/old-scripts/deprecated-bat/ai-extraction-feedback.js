#!/usr/bin/env node
/**
 * Show AI the extraction results and ask for improvements
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!supabaseKey || !openaiKey) {
  console.error('❌ Error: Missing required API keys');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: openaiKey });

async function getAIFeedback() {
  const batUrl = 'https://bringatrailer.com/listing/1989-chrysler-tc-18/';
  
  console.log('🔍 FETCHING BaT HTML...\n');
  
  // Fetch the actual HTML
  const response = await fetch(batUrl);
  const html = await response.text();
  
  // Extract a sample of the HTML (first 50KB to avoid token limits)
  const htmlSample = html.substring(0, 50000);
  
  // Call the extraction function
  console.log('📊 RUNNING EXTRACTION...\n');
  const { data: extractionResult } = await supabase.functions.invoke('comprehensive-bat-extraction', {
    body: { batUrl, vehicleId: 'ddb227f5-681f-497d-a381-de79e5252d40' }
  });
  
  if (!extractionResult || !extractionResult.success) {
    console.error('❌ Extraction failed:', extractionResult);
    return;
  }
  
  const extractedData = extractionResult.data;
  
  console.log('✅ EXTRACTION COMPLETE\n');
  console.log('='.repeat(80));
  console.log('📋 EXTRACTED DATA SUMMARY:\n');
  console.log(JSON.stringify(extractedData, null, 2));
  console.log('\n' + '='.repeat(80));
  
  // Now ask AI for feedback
  console.log('\n🤖 ASKING AI FOR IMPROVEMENTS...\n');
  
  const prompt = `You are analyzing a web scraping system that extracts vehicle auction data from Bring a Trailer (BaT) listings.

**EXTRACTED DATA:**
${JSON.stringify(extractedData, null, 2)}

**HTML SAMPLE (first 50KB):**
${htmlSample.substring(0, 20000)}...

**TASK:**
Review the extracted data and compare it against what's actually in the HTML. Identify:
1. **MISSING DATA**: What important information is in the HTML but not extracted?
2. **INCORRECT DATA**: What was extracted incorrectly?
3. **DATA QUALITY ISSUES**: What fields have poor quality (e.g., extracting JavaScript code instead of actual values)?
4. **TIMELINE EVENTS**: Are auction dates, bid dates, and sale dates being extracted correctly? Are timeline events being created with accurate dates?
5. **REGEX PATTERN SUGGESTIONS**: What regex patterns or extraction methods would work better?

**SPECIFIC ISSUES TO CHECK:**
- VIN/Chassis extraction (should be in "essentials" div)
- Sale price vs current bid (should prioritize "Sold for USD $X" over "Bid to USD $X")
- Auction dates (start, end, sale date)
- Bid history with accurate timestamps
- Seller name (not JavaScript code)
- Location (not JavaScript code)
- Interior color (not mixed with other text)
- Technical specs accuracy

**OUTPUT FORMAT:**
Provide a structured JSON response with:
{
  "missing_data": ["list of missing fields"],
  "incorrect_data": {
    "field_name": {
      "extracted": "what was extracted",
      "should_be": "what it should be",
      "location_in_html": "where to find it in HTML"
    }
  },
  "data_quality_issues": {
    "field_name": "description of issue"
  },
  "timeline_issues": ["list of timeline/date extraction problems"],
  "regex_suggestions": {
    "field_name": "improved regex pattern or extraction method"
  },
  "overall_assessment": "summary of extraction quality and priority fixes"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert web scraping and data extraction analyst. Analyze extraction results and provide actionable feedback.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 4000,
    });
    
    const feedback = completion.choices[0].message.content;
    
    console.log('='.repeat(80));
    console.log('🤖 AI FEEDBACK:\n');
    console.log(feedback);
    console.log('\n' + '='.repeat(80));
    
    // Try to parse as JSON if possible
    try {
      const jsonMatch = feedback.match(/```json\n([\s\S]*?)\n```/) || feedback.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonFeedback = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        console.log('\n📊 STRUCTURED FEEDBACK:\n');
        console.log(JSON.stringify(jsonFeedback, null, 2));
      }
    } catch (e) {
      // Not JSON, that's fine
    }
    
  } catch (error) {
    console.error('❌ AI feedback failed:', error);
  }
}

getAIFeedback().catch(console.error);

