#!/usr/bin/env node
/**
 * Test Gemini API via Edge Function
 * Calls the test-gemini edge function to verify Gemini API works
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🧪 Testing Gemini API via Edge Function...\n');
console.log(`Supabase URL: ${supabaseUrl}\n`);

async function testGeminiEdgeFunction() {
  try {
    console.log('📡 Calling test-gemini edge function...\n');
    
    // Call directly to get full response
    const response = await fetch(`${supabaseUrl}/functions/v1/test-gemini`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('⚠️  Response was not JSON:');
      console.error(responseText);
      return false;
    }
    
    if (!response.ok) {
      console.error(`❌ Edge Function returned HTTP ${response.status}:`);
      console.error(JSON.stringify(data, null, 2));
      return false;
    }
    
    // Also try the Supabase client method
    const { data: clientData, error } = await supabase.functions.invoke('test-gemini', {
      body: {}
    });

    if (error) {
      console.error('❌ Edge Function Error:');
      console.error(`   ${error.message}\n`);
      
      if (error.message.includes('Function not found')) {
        console.error('💡 The function may not be deployed yet.');
        console.error('   Deploy it with: supabase functions deploy test-gemini\n');
      }
      
      // Try to get more details
      if (error.context && error.context.body) {
        try {
          const errorBody = typeof error.context.body === 'string' 
            ? JSON.parse(error.context.body) 
            : error.context.body;
          console.error('Error details:', JSON.stringify(errorBody, null, 2));
        } catch {}
      }
      
      return false;
    }
    
    // Check if data indicates an error
    if (data && !data.success) {
      console.error('❌ Gemini API Test Failed:');
      console.error(`   ${data.error || 'Unknown error'}\n`);
      
      if (data.details) {
        console.error('Details:', data.details);
      }
      
      if (data.error && data.error.includes('GEMINI_API_KEY')) {
        console.error('\n💡 The GEMINI_API_KEY secret needs to be set in Supabase.');
        console.error('   Set it at: Supabase Dashboard > Edge Functions > Secrets');
        console.error('   Or via CLI: supabase secrets set GEMINI_API_KEY=your-key\n');
      }
      
      return false;
    }
    
    // Use direct fetch data if available, otherwise client data
    const result = data || clientData;

    console.log('📊 Response from Edge Function:\n');
    console.log(JSON.stringify(result, null, 2));
    console.log('\n');

    if (result.success) {
      console.log('✅ SUCCESS! Gemini API is working via Edge Function!\n');
      
      if (result.text) {
        console.log(`📝 Text API Response: "${result.text.response}"`);
        console.log(`   Finish Reason: ${result.text.finishReason}`);
        if (result.text.usageMetadata) {
          console.log(`   Tokens Used: ${result.text.usageMetadata.totalTokenCount}`);
        }
      }
      
      if (result.vision && result.vision.success) {
        console.log(`\n🖼️  Vision API Response: "${result.vision.response}"`);
      } else if (result.vision) {
        console.log(`\n⚠️  Vision test failed: ${result.vision.error}`);
      }
      
      console.log('\n✅ Gemini API is fully functional!\n');
      return true;
    } else {
      console.error('❌ Gemini API test failed:');
      console.error(`   ${data.error || 'Unknown error'}\n`);
      
      if (data.error && data.error.includes('GEMINI_API_KEY')) {
        console.error('💡 The GEMINI_API_KEY secret needs to be set in Supabase.');
        console.error('   Set it at: Supabase Dashboard > Edge Functions > Secrets\n');
      }
      
      return false;
    }
    
  } catch (error) {
    console.error('\n❌ Error calling edge function:');
    console.error(`   ${error.message}\n`);
    
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      console.error('💡 This might indicate:');
      console.error('   - Edge function not deployed');
      console.error('   - Network connectivity issue');
      console.error('   - Invalid Supabase URL\n');
    }
    
    return false;
  }
}

async function main() {
  const success = await testGeminiEdgeFunction();
  
  console.log('='.repeat(60));
  console.log('📋 TEST SUMMARY:');
  console.log(`   Status: ${success ? '✅ Working' : '❌ Failed'}`);
  console.log('='.repeat(60) + '\n');
  
  if (!success) {
    process.exit(1);
  }
}

main().catch(console.error);

