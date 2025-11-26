#!/usr/bin/env node
/**
 * Test Gemini API Connection
 * Simple test to verify Gemini API key and endpoint work
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

// Get API key from env, command line arg, or prompt
let GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.argv[2];

if (!GEMINI_API_KEY) {
  console.error('❌ Error: GEMINI_API_KEY not found');
  console.error('\n📋 To run this test:');
  console.error('   1. Set in .env: GEMINI_API_KEY=your-key-here');
  console.error('   2. Or pass as argument: node scripts/test-gemini-api.js YOUR_API_KEY');
  console.error('   3. Get your API key at: https://makersuite.google.com/app/apikey');
  console.error('\n💡 You can also test with:');
  console.error('   GEMINI_API_KEY=your-key node scripts/test-gemini-api.js\n');
  process.exit(1);
}

console.log('🧪 Testing Gemini API Connection...\n');
console.log(`API Key: ${GEMINI_API_KEY.substring(0, 10)}...${GEMINI_API_KEY.substring(GEMINI_API_KEY.length - 4)}\n`);

async function testGeminiAPI() {
  try {
    console.log('📡 Making test API call to Gemini 1.5 Flash...');
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: 'Say "Hello, Gemini API is working!" in exactly 5 words.'
            }]
          }],
          generationConfig: {
            maxOutputTokens: 50,
            temperature: 0.1
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`\n❌ API Error: HTTP ${response.status}`);
      console.error(`Response: ${errorText}`);
      
      if (response.status === 400) {
        console.error('\n💡 This might indicate:');
        console.error('   - Invalid API key');
        console.error('   - API key not enabled for Gemini API');
      } else if (response.status === 403) {
        console.error('\n💡 This might indicate:');
        console.error('   - API key doesn\'t have permission');
        console.error('   - API quota exceeded');
      } else if (response.status === 401) {
        console.error('\n💡 This might indicate:');
        console.error('   - Invalid or expired API key');
      }
      
      process.exit(1);
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      console.error('\n❌ Unexpected response format:');
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    const answer = data.candidates[0].content.parts[0].text;
    
    console.log('\n✅ SUCCESS! Gemini API is working!\n');
    console.log(`Response: "${answer.trim()}"\n`);
    console.log('📊 API Response Details:');
    console.log(`   Model: gemini-1.5-flash`);
    console.log(`   Status: OK`);
    console.log(`   Finish Reason: ${data.candidates[0].finishReason || 'N/A'}`);
    
    if (data.usageMetadata) {
      console.log(`   Tokens Used: ${data.usageMetadata.totalTokenCount || 'N/A'}`);
    }
    
    console.log('\n✅ Gemini API is ready to use!\n');
    return true;
    
  } catch (error) {
    console.error('\n❌ Error calling Gemini API:');
    console.error(`   ${error.message}\n`);
    
    if (error.message.includes('fetch failed')) {
      console.error('💡 This might indicate:');
      console.error('   - Network connectivity issue');
      console.error('   - Firewall blocking the request');
      console.error('   - DNS resolution problem');
    }
    
    process.exit(1);
  }
}

// Test with image (optional - tests vision capabilities)
async function testGeminiVision() {
  try {
    console.log('\n🖼️  Testing Gemini Vision API with sample image...');
    
    // Use a publicly accessible test image
    const testImageUrl = 'https://via.placeholder.com/300x200.png';
    
    const imageResponse = await fetch(testImageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: 'What do you see in this image? Describe it in one sentence.'
              },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            maxOutputTokens: 100,
            temperature: 0.3
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`\n⚠️  Vision API Error: HTTP ${response.status}`);
      console.error(`Response: ${errorText}`);
      return false;
    }

    const data = await response.json();
    const answer = data.candidates[0].content.parts[0].text;
    
    console.log(`✅ Vision API Response: "${answer.trim()}"\n`);
    return true;
    
  } catch (error) {
    console.error(`\n⚠️  Vision test failed: ${error.message}`);
    console.error('   (Text-only API still works, vision might need different setup)\n');
    return false;
  }
}

// Run tests
async function main() {
  const textTest = await testGeminiAPI();
  
  if (textTest) {
    // Only test vision if text API works
    await testGeminiVision();
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📋 TEST SUMMARY:');
  console.log(`   Text API: ${textTest ? '✅ Working' : '❌ Failed'}`);
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);

