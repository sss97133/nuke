#!/usr/bin/env npx tsx
/**
 * Test Facebook Marketplace GraphQL Access
 *
 * Tests whether we can query FB Marketplace without authentication.
 */

const FB_GRAPHQL_ENDPOINT = "https://www.facebook.com/api/graphql/";
const DOC_ID = "3456763434364354"; // MarketplaceSearchResultsPageContainerNewQuery

// Test locations
const TEST_LOCATIONS = [
  { name: "Austin, TX", lat: 30.2672, lng: -97.7431 },
  { name: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
  { name: "Miami, FL", lat: 25.7617, lng: -80.1918 },
];

async function testGraphQLQuery(location: { name: string; lat: number; lng: number }) {
  console.log(`\n🔍 Testing: ${location.name}`);
  console.log(`   Coordinates: ${location.lat}, ${location.lng}`);

  const variables = {
    params: {
      bqf: {
        callsite: "COMMERCE_MKTPLACE_WWW",
        query: "",
      },
      browse_request_params: {
        filter_location_latitude: location.lat,
        filter_location_longitude: location.lng,
        filter_radius_km: 64,
        commerce_search_sort_by: "CREATION_TIME_DESCEND",
        filter_category_ids: ["vehicles"],
        vehicle_year_min: 1960,
        vehicle_year_max: 1999,
      },
      custom_request_params: {
        surface: "SEARCH",
        search_vertical: "C2C",
      },
    },
    MARKETPLACE_FEED_ITEM_IMAGE_WIDTH: 196,
    count: 24,
  };

  try {
    console.log("\n   Attempt 1: Standard POST");
    const response1 = await fetch(FB_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://www.facebook.com",
        Referer: "https://www.facebook.com/marketplace/",
      },
      body: new URLSearchParams({
        doc_id: DOC_ID,
        variables: JSON.stringify(variables),
      }).toString(),
    });

    console.log(`   Status: ${response1.status} ${response1.statusText}`);

    const text1 = await response1.text();
    console.log(`   Response length: ${text1.length} chars`);

    if (text1.length < 1000) {
      console.log(`   Response: ${text1.substring(0, 500)}`);
    } else {
      // Try to parse as JSON
      try {
        const json = JSON.parse(text1);
        if (json.error) {
          console.log(`   ❌ Error: ${JSON.stringify(json.error)}`);
        } else if (json.data?.marketplace_search) {
          const edges = json.data.marketplace_search.feed_units?.edges || [];
          console.log(`   ✅ SUCCESS! Found ${edges.length} listings`);
          if (edges.length > 0) {
            console.log(`   First listing: ${JSON.stringify(edges[0]?.node?.listing?.marketplace_listing_title || edges[0]?.node?.marketplace_listing_title, null, 2)}`);
          }
        } else {
          console.log(`   ⚠️ Unexpected response structure`);
          console.log(`   Keys: ${Object.keys(json).join(", ")}`);
        }
      } catch {
        console.log(`   Response preview: ${text1.substring(0, 300)}...`);
      }
    }
  } catch (error: any) {
    console.log(`   ❌ Request failed: ${error.message}`);
  }

  // Test alternative: direct URL fetch
  console.log("\n   Attempt 2: Direct marketplace URL");
  try {
    const directUrl = `https://www.facebook.com/marketplace/${location.name.split(",")[0].toLowerCase().replace(/\s+/g, "")}/vehicles?minYear=1960&maxYear=1999`;
    console.log(`   URL: ${directUrl}`);

    const response2 = await fetch(directUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    console.log(`   Status: ${response2.status}`);

    const html = await response2.text();
    console.log(`   Response length: ${html.length} chars`);

    // Check for login wall
    if (html.includes("log in") || html.includes("Log In") || html.includes("login")) {
      console.log(`   ⚠️ Login wall detected`);
    }

    // Check for listing data in HTML
    if (html.includes("marketplace_listing_title") || html.includes("MarketplaceFeed")) {
      console.log(`   ✅ Marketplace data found in HTML`);
    }

    // Look for embedded JSON data
    const jsonMatch = html.match(/"marketplace_search":\s*(\{[^}]+\})/);
    if (jsonMatch) {
      console.log(`   ✅ Found embedded marketplace data`);
    }
  } catch (error: any) {
    console.log(`   ❌ Direct fetch failed: ${error.message}`);
  }
}

async function testAlternativeEndpoints() {
  console.log("\n\n📡 Testing Alternative Endpoints\n");

  // Test 1: m.facebook.com (mobile)
  console.log("1. Mobile endpoint (m.facebook.com)");
  try {
    const mobileUrl = "https://m.facebook.com/marketplace/austin/vehicles";
    const response = await fetch(mobileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15A372 Safari/604.1",
      },
    });
    console.log(`   Status: ${response.status}`);
    const text = await response.text();
    console.log(`   Response length: ${text.length} chars`);
    if (text.includes("login") || text.includes("Log In")) {
      console.log(`   ⚠️ Login required on mobile`);
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 2: Graph API (unlikely to work without auth)
  console.log("\n2. Graph API endpoint");
  try {
    const graphUrl = "https://graph.facebook.com/v18.0/marketplace";
    const response = await fetch(graphUrl);
    console.log(`   Status: ${response.status}`);
    const text = await response.text();
    console.log(`   Response: ${text.substring(0, 200)}`);
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 3: Public marketplace item page
  console.log("\n3. Public listing page (known listing ID)");
  try {
    // This is a made-up ID - replace with real ID for actual testing
    const listingUrl = "https://www.facebook.com/marketplace/item/123456789012345";
    const response = await fetch(listingUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    console.log(`   Status: ${response.status}`);
    if (response.status === 302 || response.status === 301) {
      console.log(`   Redirect to: ${response.headers.get("location")}`);
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

async function main() {
  console.log("🚀 Facebook Marketplace Access Test");
  console.log("====================================");
  console.log(`Endpoint: ${FB_GRAPHQL_ENDPOINT}`);
  console.log(`Doc ID: ${DOC_ID}`);
  console.log(`Year filter: 1960-1999 (vintage vehicles)`);

  // Test each location
  for (const location of TEST_LOCATIONS) {
    await testGraphQLQuery(location);
    // Small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Test alternative endpoints
  await testAlternativeEndpoints();

  console.log("\n\n📊 Summary");
  console.log("==========");
  console.log(
    "If GraphQL queries returned listings without auth, we can proceed with the sweep engine."
  );
  console.log(
    "If login is required, we need either session management or Playwright automation."
  );
}

main().catch(console.error);
