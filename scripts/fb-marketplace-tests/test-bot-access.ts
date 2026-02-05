#!/usr/bin/env npx tsx
/**
 * Test Bot/Crawler Access to Facebook Marketplace
 *
 * Facebook serves different content to search engine bots for SEO.
 * This might include structured listing data.
 */

import * as fs from "fs/promises";

const BOT_USER_AGENTS = [
  {
    name: "Googlebot",
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  {
    name: "Googlebot-Mobile",
    ua: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  {
    name: "Bingbot",
    ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  },
  {
    name: "Facebot",
    ua: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  },
];

async function testBotAccess() {
  console.log("🤖 Testing Bot Access to Facebook Marketplace");
  console.log("=============================================\n");

  const testUrls = [
    "https://www.facebook.com/marketplace/austin/vehicles",
    "https://www.facebook.com/marketplace/item/1234567890", // Fake ID
  ];

  for (const url of testUrls) {
    console.log(`\n📍 URL: ${url}\n`);

    for (const { name, ua } of BOT_USER_AGENTS) {
      console.log(`\n🤖 Testing: ${name}`);

      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": ua,
            Accept: "text/html,application/xhtml+xml",
          },
        });

        console.log(`   Status: ${response.status}`);

        const html = await response.text();
        console.log(`   Response size: ${(html.length / 1024).toFixed(1)}KB`);

        // Check for structured data
        const ldJsonMatches = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
        if (ldJsonMatches) {
          console.log(`   ✅ Found ${ldJsonMatches.length} LD+JSON blocks (structured data)`);

          // Parse and log structured data
          for (let i = 0; i < Math.min(ldJsonMatches.length, 3); i++) {
            try {
              const jsonContent = ldJsonMatches[i].match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1];
              if (jsonContent) {
                const data = JSON.parse(jsonContent);
                console.log(`      Block ${i + 1}: @type = ${data["@type"] || "unknown"}`);
                if (data["@type"] === "Product" || data["@type"] === "Vehicle") {
                  console.log(`      📦 Product/Vehicle data found!`);
                  console.log(`         Name: ${data.name?.substring(0, 50)}`);
                  console.log(`         Price: ${data.offers?.price || data.price}`);
                }
              }
            } catch {}
          }
        }

        // Check for Open Graph data
        const ogMatches = html.match(/<meta property="og:[^"]*"[^>]*>/gi);
        if (ogMatches) {
          console.log(`   ✅ Found ${ogMatches.length} Open Graph tags`);
          const ogTitle = html.match(/property="og:title"[^>]*content="([^"]*)"/i)?.[1];
          const ogDesc = html.match(/property="og:description"[^>]*content="([^"]*)"/i)?.[1];
          if (ogTitle) console.log(`      og:title = ${ogTitle.substring(0, 60)}`);
          if (ogDesc) console.log(`      og:description = ${ogDesc.substring(0, 60)}`);
        }

        // Look for marketplace listing patterns
        const listingPatterns = [
          { name: "marketplace_listing_title", regex: /marketplace_listing_title/gi },
          { name: "listing_price", regex: /"listing_price"/gi },
          { name: "feed_units", regex: /"feed_units"/gi },
          { name: "price amounts", regex: /"\$[\d,]+"/g },
          { name: "vehicle_year", regex: /vehicle_year/gi },
          { name: "mileage", regex: /mileage.*?[\d,]+/gi },
        ];

        console.log(`   Listing patterns found:`);
        for (const { name, regex } of listingPatterns) {
          const matches = html.match(regex);
          if (matches && matches.length > 0) {
            console.log(`      ${name}: ${matches.length} matches`);
            if (name === "price amounts" && matches.length > 0) {
              console.log(`         Sample: ${matches.slice(0, 5).join(", ")}`);
            }
          }
        }

        // Save response for detailed analysis
        const safeUrl = url.replace(/[^a-z0-9]/gi, "_").substring(0, 30);
        const safeName = name.replace(/[^a-z0-9]/gi, "_");
        const filename = `bot_${safeName}_${safeUrl}.html`;
        await fs.writeFile(`/Users/skylar/nuke/scripts/fb-marketplace-tests/${filename}`, html);
        console.log(`   💾 Saved: ${filename}`);

      } catch (error: any) {
        console.log(`   ❌ Error: ${error.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function analyzeGooglebotResponse() {
  console.log("\n\n📊 Deep Analysis of Googlebot Response");
  console.log("======================================\n");

  try {
    const response = await fetch("https://www.facebook.com/marketplace/austin/vehicles", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html",
      },
    });

    const html = await response.text();

    // Extract all script blocks
    const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    console.log(`Total script blocks: ${scripts.length}`);

    // Find scripts with data
    let dataScripts = 0;
    for (const script of scripts) {
      if (
        script.includes("marketplace") ||
        script.includes("listing") ||
        script.includes("feed_units")
      ) {
        dataScripts++;
      }
    }
    console.log(`Scripts with marketplace data: ${dataScripts}`);

    // Look for inline JSON data
    const jsonPatterns = [
      /__RELAY_DATA__\s*=\s*({[\s\S]*?});/,
      /window\.__data\s*=\s*({[\s\S]*?});/,
      /"data":\s*({[\s\S]*?"marketplace_search"[\s\S]*?})/,
    ];

    for (const pattern of jsonPatterns) {
      const match = html.match(pattern);
      if (match) {
        console.log(`\n✅ Found JSON data matching pattern: ${pattern.source.substring(0, 30)}...`);
        console.log(`   Length: ${match[1].length} chars`);
        try {
          const data = JSON.parse(match[1]);
          console.log(`   Keys: ${Object.keys(data).slice(0, 10).join(", ")}`);
        } catch {
          console.log(`   (Could not parse as JSON)`);
        }
      }
    }

    // Extract any visible listing data
    const priceMatches = html.match(/\$[\d,]+(?:\.\d{2})?/g);
    if (priceMatches) {
      const uniquePrices = [...new Set(priceMatches)].slice(0, 20);
      console.log(`\n💰 Price values found: ${uniquePrices.join(", ")}`);
    }

    // Look for listing URLs/IDs
    const listingIds = html.match(/\/marketplace\/item\/(\d+)/g);
    if (listingIds) {
      const uniqueIds = [...new Set(listingIds)].slice(0, 10);
      console.log(`\n🔗 Listing IDs found: ${uniqueIds.length}`);
      console.log(`   Sample: ${uniqueIds.slice(0, 5).join(", ")}`);
    }

    // Save parsed analysis
    await fs.writeFile(
      "/Users/skylar/nuke/scripts/fb-marketplace-tests/googlebot_analysis.txt",
      `Response size: ${html.length}
Script blocks: ${scripts.length}
Data scripts: ${dataScripts}
Prices found: ${priceMatches?.length || 0}
Listing IDs: ${listingIds?.length || 0}

Sample listing IDs:
${listingIds?.slice(0, 10).join("\n") || "None"}

Sample prices:
${priceMatches?.slice(0, 20).join("\n") || "None"}
`
    );

  } catch (error: any) {
    console.log(`Error: ${error.message}`);
  }
}

async function main() {
  await testBotAccess();
  await analyzeGooglebotResponse();

  console.log("\n\n✅ Testing Complete");
  console.log("==================");
  console.log("If Googlebot gets structured data, we can use that approach.");
}

main().catch(console.error);
