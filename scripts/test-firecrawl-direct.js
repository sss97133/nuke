#!/usr/bin/env node
/**
 * Test Firecrawl API directly to verify the key works
 */

const FIRECRAWL_KEY = 'REDACTED-ROTATE-THIS-KEY';
const TEST_URL = 'https://cars.ksl.com/listing/10323198';

async function testFirecrawl() {
  console.log('🔥 Testing Firecrawl API directly...\n');
  console.log(`URL: ${TEST_URL}\n`);
  
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: TEST_URL,
        waitFor: 2000,
        formats: ['html', 'markdown']
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Firecrawl API Error (${response.status}):`);
      console.error(errorText);
      return;
    }
    
    const data = await response.json();
    
    if (data.success && data.data) {
      console.log('✅ Firecrawl API is working!');
      console.log(`   HTML length: ${data.data.html?.length || 0} chars`);
      console.log(`   Markdown length: ${data.data.markdown?.length || 0} chars`);
      
      // Check if we got the actual page content
      if (data.data.html && data.data.html.includes('Chevrolet')) {
        console.log('   ✅ Got actual KSL page content!');
      } else if (data.data.html && data.data.html.includes('denied')) {
        console.log('   ⚠️  Still getting access denied');
      }
    } else {
      console.log('⚠️  Unexpected response:', JSON.stringify(data, null, 2).substring(0, 500));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testFirecrawl();

