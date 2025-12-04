#!/usr/bin/env node
require('dotenv').config();
const FirecrawlApp = require('@mendable/firecrawl-js').default;
const fs = require('fs');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY environment variable is required');
  process.exit(1);
}

const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });

async function mapLMC() {
  console.log('🗺️  Mapping LMC website structure...\n');
  
  try {
    // Map the LMC interior/seats section as a test
    const map = await firecrawl.mapUrl('https://www.lmctruck.com/interior', {
      search: 'mount bracket seat'
    });

    console.log(`✅ Found ${map.links?.length || 0} links\n`);

    if (map.links) {
      // Save all links
      fs.writeFileSync('/Users/skylar/nuke/lmc-map.json', JSON.stringify(map, null, 2));
      console.log('💾 Saved to lmc-map.json\n');

      // Show product links
      console.log('🔗 Product URLs found:');
      map.links
        .filter(link => link.includes('38-') || link.includes('30-'))
        .slice(0, 20)
        .forEach(link => console.log(`  - ${link}`));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

mapLMC();

