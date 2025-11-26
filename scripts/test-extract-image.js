/**
 * Test extract-image edge function
 * Usage: node scripts/test-extract-image.js <image_url> [prompt]
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error('❌ Error: SUPABASE_ANON_KEY not found in environment variables');
  process.exit(1);
}

const imageUrl = process.argv[2];
const customPrompt = process.argv[3];

if (!imageUrl) {
  console.error('❌ Error: image_url is required');
  console.error('   Usage: node scripts/test-extract-image.js <image_url> [prompt]');
  console.error('   Example: node scripts/test-extract-image.js https://example.com/image.jpg');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testExtractImage() {
  console.log('🧪 Testing extract-image edge function...\n');
  console.log(`Image URL: ${imageUrl}`);
  if (customPrompt) {
    console.log(`Custom Prompt: ${customPrompt}`);
  }
  console.log('');

  try {
    const { data, error } = await supabase.functions.invoke('extract-image', {
      body: {
        image_url: imageUrl,
        prompt: customPrompt
      }
    });

    if (error) {
      console.error('❌ Error calling edge function:', error);
      
      // Try to get the actual error response
      if (error.context && error.context.body) {
        try {
          const errorText = await error.context.text();
          console.error('Error response:', errorText);
        } catch (e) {
          // Ignore if we can't read body
        }
      }
      return;
    }

    if (data.success) {
      console.log('✅ Extraction successful!\n');
      console.log('📊 Extracted Data:');
      console.log(JSON.stringify(data.extracted_data, null, 2));
      console.log('\n📈 Metadata:');
      console.log(`   Model: ${data.metadata.model}`);
      if (data.metadata.tokens) {
        console.log(`   Tokens: ${data.metadata.tokens.total} (input: ${data.metadata.tokens.input}, output: ${data.metadata.tokens.output})`);
      } else {
        console.log(`   Tokens Used: ${data.metadata.tokens_used || 'N/A'}`);
      }
      if (data.metadata.cost) {
        console.log(`   Cost: $${data.metadata.cost.total_cost}`);
      }
      console.log(`   Finish Reason: ${data.metadata.finish_reason}`);
    } else {
      console.error('❌ Extraction failed:', data.error);
      if (data.details) {
        console.error('   Details:', data.details);
      }
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

testExtractImage();

