#!/usr/bin/env npx tsx
/**
 * Test Facebook Marketplace Mobile Endpoint
 *
 * The mobile endpoint (m.facebook.com) returned 200 - let's explore what's there.
 */

async function testMobileMarketplace() {
  console.log("🔍 Testing Mobile Facebook Marketplace");
  console.log("======================================\n");

  const testUrls = [
    "https://m.facebook.com/marketplace/austin/vehicles",
    "https://m.facebook.com/marketplace/category/vehicles",
    "https://m.facebook.com/marketplace/vehicles?minYear=1960&maxYear=1999",
    "https://m.facebook.com/marketplace/search/?query=classic%20car",
    "https://m.facebook.com/marketplace/108114795872715/vehicles/", // Austin location ID
  ];

  for (const url of testUrls) {
    console.log(`\n📱 Testing: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });

      console.log(`   Status: ${response.status}`);
      console.log(`   Final URL: ${response.url}`);

      const html = await response.text();
      console.log(`   Response length: ${html.length} chars`);

      // Check for login requirements
      if (html.includes("Log In") || html.includes("log in") || html.includes("login")) {
        console.log(`   ⚠️ Login prompt detected`);
      }

      // Look for listing data
      const listingMatches = html.match(/marketplace_listing/gi);
      if (listingMatches) {
        console.log(`   ✅ Found ${listingMatches.length} listing references`);
      }

      // Look for JSON data embedded in page
      const scriptMatches = html.match(/<script[^>]*>([^<]*__RELAY_DATA__|[^<]*marketplace_search[^<]*)<\/script>/gi);
      if (scriptMatches) {
        console.log(`   ✅ Found ${scriptMatches.length} data scripts`);
      }

      // Look for specific markers
      const markers = [
        "MarketplaceFeed",
        "marketplace_search",
        "listing_price",
        "feed_units",
        "search_results",
        "item_id",
        "vehicle_year",
      ];

      const foundMarkers = markers.filter((m) => html.includes(m));
      if (foundMarkers.length > 0) {
        console.log(`   ✅ Found markers: ${foundMarkers.join(", ")}`);
      }

      // Extract any visible text that looks like listings
      const priceMatches = html.match(/\$[\d,]+/g);
      if (priceMatches) {
        console.log(`   💰 Prices found: ${priceMatches.slice(0, 5).join(", ")}...`);
      }

      // Save full response for analysis
      const filename = url.replace(/[^a-z0-9]/gi, "_").substring(0, 50);
      const fs = await import("fs/promises");
      await fs.writeFile(
        `/Users/skylar/nuke/scripts/fb-marketplace-tests/response_${filename}.html`,
        html
      );
      console.log(`   💾 Saved to response_${filename}.html`);
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function testBasicWebMarketplace() {
  console.log("\n\n🌐 Testing Basic Web Marketplace (www)");
  console.log("======================================\n");

  // Try with cookies disabled, different user agents
  const userAgents = [
    {
      name: "Chrome Desktop",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    {
      name: "Firefox",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
    },
    {
      name: "Googlebot",
      ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    },
    {
      name: "curl",
      ua: "curl/7.64.1",
    },
  ];

  const testUrl = "https://www.facebook.com/marketplace/austin/vehicles";

  for (const { name, ua } of userAgents) {
    console.log(`\n🔍 Testing with: ${name}`);

    try {
      const response = await fetch(testUrl, {
        headers: {
          "User-Agent": ua,
          Accept: "text/html",
        },
        redirect: "follow",
      });

      console.log(`   Status: ${response.status}`);

      if (response.status === 200) {
        const html = await response.text();
        console.log(`   Length: ${html.length} chars`);

        if (html.includes("Log In") || html.includes("login")) {
          console.log(`   ⚠️ Login required`);
        } else {
          console.log(`   ✅ No login wall!`);
        }
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function analyzeMarketplaceAPIPaths() {
  console.log("\n\n🔬 Testing Known API Paths");
  console.log("==========================\n");

  // These are paths that might expose data
  const apiPaths = [
    {
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      body: "fb_api_caller_class=RelayModern&fb_api_req_friendly_name=MarketplaceSearchRootQuery&variables=%7B%7D&server_timestamps=true&doc_id=4476599072415612",
    },
    {
      url: "https://www.facebook.com/marketplace/api/search",
      method: "GET",
    },
    {
      url: "https://www.facebook.com/ajax/marketplace/search/",
      method: "GET",
    },
    {
      url: "https://web.facebook.com/marketplace/austin/vehicles",
      method: "GET",
    },
  ];

  for (const { url, method, body } of apiPaths) {
    console.log(`\n📡 ${method} ${url}`);

    try {
      const options: RequestInit = {
        method,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "application/json, text/html, */*",
          "Content-Type": method === "POST" ? "application/x-www-form-urlencoded" : undefined,
        } as any,
      };

      if (body && method === "POST") {
        options.body = body;
      }

      const response = await fetch(url, options);
      console.log(`   Status: ${response.status}`);

      const contentType = response.headers.get("content-type");
      console.log(`   Content-Type: ${contentType}`);

      if (response.status === 200) {
        const text = await response.text();
        console.log(`   Length: ${text.length}`);
        if (text.length < 500) {
          console.log(`   Response: ${text}`);
        }
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function main() {
  await testMobileMarketplace();
  await testBasicWebMarketplace();
  await analyzeMarketplaceAPIPaths();

  console.log("\n\n📊 Test Complete");
  console.log("================");
  console.log("Check the saved HTML files for detailed analysis.");
}

main().catch(console.error);
