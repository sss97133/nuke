#!/usr/bin/env node

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function testClaudeAPI() {
  console.log('🧪 Testing Claude API directly...');

  const claudeApiKey = process.env.NUKE_CLAUDE_API;
  if (!claudeApiKey) {
    console.error('❌ NUKE_CLAUDE_API not found in environment');
    return false;
  }

  try {
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${claudeApiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: 'Just respond with "API test successful"'
        }]
      })
    });

    console.log('Claude API Status:', claudeResponse.status);

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('❌ Claude API Error:', errorText);
      return false;
    }

    const claudeData = await claudeResponse.json();
    console.log('✅ Claude API Response:', claudeData.content?.[0]?.text);
    return true;

  } catch (error) {
    console.error('❌ Claude API Exception:', error.message);
    return false;
  }
}

async function testFirecrawlAPI() {
  console.log('\n🧪 Testing Firecrawl API directly...');

  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlApiKey) {
    console.error('❌ FIRECRAWL_API_KEY not found in environment');
    return false;
  }

  try {
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v0/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: 'https://www.example.com',
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 1000
      })
    });

    console.log('Firecrawl API Status:', firecrawlResponse.status);

    if (!firecrawlResponse.ok) {
      const errorText = await firecrawlResponse.text();
      console.error('❌ Firecrawl API Error:', errorText);
      return false;
    }

    const firecrawlData = await firecrawlResponse.json();
    console.log('✅ Firecrawl API Success:', firecrawlData.success ? 'Working' : 'Failed');
    return firecrawlData.success;

  } catch (error) {
    console.error('❌ Firecrawl API Exception:', error.message);
    return false;
  }
}

async function main() {
  console.log('🔑 Testing API Keys Directly\n');

  const claudeWorks = await testClaudeAPI();
  const firecrawlWorks = await testFirecrawlAPI();

  console.log('\n📊 API Test Results:');
  console.log(`Claude API: ${claudeWorks ? '✅ Working' : '❌ Failed'}`);
  console.log(`Firecrawl API: ${firecrawlWorks ? '✅ Working' : '❌ Failed'}`);

  if (claudeWorks && firecrawlWorks) {
    console.log('\n🎉 Both APIs are working! Issue must be in Edge Function implementation.');
  } else {
    console.log('\n⚠️ API issues detected. Need to check credentials or API status.');
  }
}

main();