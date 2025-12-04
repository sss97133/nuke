#!/usr/bin/env node
/**
 * TEST FIRECRAWL WITH LMC
 * Quick test to verify Firecrawl API works with LMC
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const testPart = '38-2166'; // MOUNT BRACKET-BENCH SEAT-REAR

async function test() {
  console.log('🔥 Testing Firecrawl with LMC...\n');
  
  const searchUrl = `https://www.lmctruck.com/search?query=${testPart}`;
  console.log(`📍 Searching: ${searchUrl}\n`);

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ['markdown', 'html']
      })
    });

    console.log(`📊 Status: ${response.status}\n`);

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Error:', error);
      return;
    }

    const data = await response.json();
    console.log('✅ Success!');
    console.log('\n📄 Response structure:', Object.keys(data));
    console.log('\n📝 Data keys:', data.data ? Object.keys(data.data) : 'No data key');
    
    if (data.data?.html) {
      console.log('\n🔍 HTML length:', data.data.html.length);
      console.log('🔍 First 500 chars:', data.data.html.substring(0, 500));
      
      // Try to find product link
      const productMatch = data.data.html.match(/href="([^"]*\/products\/[^"]*)"/);
      if (productMatch) {
        console.log('\n✅ Found product link:', productMatch[1]);
      } else {
        console.log('\n⚠️  No product link found in HTML');
      }
    }

    if (data.data?.markdown) {
      console.log('\n📝 Markdown length:', data.data.markdown.length);
      console.log('📝 First 500 chars:', data.data.markdown.substring(0, 500));
    }

  } catch (error) {
    console.error('❌ Exception:', error.message);
  }
}

test();

