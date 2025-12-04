#!/usr/bin/env node
require('dotenv').config();
const FirecrawlApp = require('@mendable/firecrawl-js').default;

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY environment variable is required');
  process.exit(1);
}

const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });

async function test() {
  console.log('🔍 Testing Firecrawl search...\n');
  
  const testPart = '38-2166';
  
  // Try different search queries
  const queries = [
    `LMC ${testPart}`,
    `LMC Truck ${testPart}`,
    `${testPart} LMC mount bracket`,
  ];

  for (const query of queries) {
    console.log(`\nQuery: "${query}"`);
    try {
      const results = await firecrawl.search(query, { limit: 3 });
      console.log(`  Results: ${results.data?.length || 0}`);
      
      if (results.data && results.data.length > 0) {
        results.data.slice(0, 2).forEach((r, i) => {
          console.log(`  [${i+1}] ${r.title}`);
          console.log(`      ${r.url}`);
        });
      }
    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }
  }
}

test().catch(console.error);

