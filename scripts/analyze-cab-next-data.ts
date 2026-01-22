/**
 * Analyze Cars & Bids __NEXT_DATA__ structure
 * Fetch a C&B listing and show what's available
 */

async function main() {
  // Use an active C&B listing URL
  const testUrls = [
    'https://carsandbids.com/auctions/rl2kxb5M/2018-mclaren-720s',
    'https://carsandbids.com/auctions/3LPlyGNd/2016-mazda-mx-5-miata-club',
  ];

  for (const url of testUrls) {
    console.log(`\n=== ANALYZING: ${url} ===\n`);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        console.log(`❌ HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();
      console.log(`HTML length: ${html.length}`);

      // Find __NEXT_DATA__
      const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);

      if (!nextDataMatch) {
        console.log('❌ No __NEXT_DATA__ found');
        continue;
      }

      console.log('✅ Found __NEXT_DATA__');
      const nextData = JSON.parse(nextDataMatch[1]);

      // Show structure
      console.log('\n📊 TOP LEVEL KEYS:', Object.keys(nextData));
      console.log('📊 props KEYS:', Object.keys(nextData.props || {}));
      console.log('📊 pageProps KEYS:', Object.keys(nextData.props?.pageProps || {}));

      const pageProps = nextData.props?.pageProps || {};

      // Check for auction data
      if (pageProps.auction) {
        console.log('\n✅ Found pageProps.auction!');
        const auction = pageProps.auction;
        console.log('📊 auction KEYS:', Object.keys(auction));

        // Check for images
        if (auction.images) {
          console.log(`✅ Images: ${auction.images.length}`);
          if (auction.images.length > 0) {
            console.log('   Sample image:', JSON.stringify(auction.images[0], null, 2).substring(0, 300));
          }
        }

        // Check for vehicle data
        console.log('\n📋 VEHICLE DATA:');
        console.log('   title:', auction.title);
        console.log('   mileage:', auction.mileage);
        console.log('   vin:', auction.vin);
        console.log('   color:', auction.color);
        console.log('   transmission:', auction.transmission);
        console.log('   engine:', auction.engine);
        console.log('   location:', auction.location);

        // Check for bids
        if (auction.bids) {
          console.log(`\n✅ Bids: ${auction.bids.length || (auction.bids?.edges?.length || 0)}`);
        }

        // Check for comments
        if (auction.comments) {
          console.log(`✅ Comments: ${auction.comments.length || (auction.comments?.edges?.length || 0)}`);
        }

        // Check for specs/highlights
        console.log('\n📋 CONTENT SECTIONS:');
        console.log('   highlights:', auction.highlights?.substring(0, 100));
        console.log('   equipment:', auction.equipment?.substring(0, 100));
        console.log('   modifications:', auction.modifications?.substring(0, 100));
        console.log('   known_flaws:', auction.known_flaws?.substring(0, 100));
      } else {
        console.log('❌ No pageProps.auction');

        // Try other paths
        const candidates = [
          pageProps.data?.auction,
          pageProps.listing,
          pageProps.vehicle,
        ];

        for (const c of candidates) {
          if (c) {
            console.log('✅ Found alternative path:', Object.keys(c).slice(0, 20));
          }
        }
      }

    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
    }
  }
}

main();
