#!/usr/bin/env npx tsx
/**
 * Extract Actual Listings from Googlebot Response
 *
 * DISCOVERY: Using Googlebot user agent, Facebook returns full listing data!
 * This script extracts and parses the actual listing data.
 */

import * as fs from "fs/promises";

const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

interface ExtractedListing {
  id: string;
  title: string;
  price: number | null;
  location: string | null;
  imageUrl: string | null;
  url: string;
  year?: number;
  make?: string;
  model?: string;
  mileage?: number;
}

async function fetchMarketplacePage(location: string): Promise<string> {
  const url = `https://www.facebook.com/marketplace/${location}/vehicles`;
  console.log(`🔍 Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": GOOGLEBOT_UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function extractListingsFromHTML(html: string): ExtractedListing[] {
  const listings: ExtractedListing[] = [];

  // Strategy 1: Look for JSON data embedded in script tags
  // Facebook often includes data in __RELAY_DATA__ or similar
  const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];

  for (const script of scriptMatches) {
    // Look for marketplace listing data
    if (script.includes("marketplace_listing_title") || script.includes("feed_units")) {
      // Try to extract JSON objects
      const jsonMatches = script.match(/\{[^{}]*"marketplace_listing_title"[^{}]*\}/g);
      if (jsonMatches) {
        for (const jsonStr of jsonMatches) {
          try {
            // This might not be valid JSON on its own, but let's try
            const titleMatch = jsonStr.match(/"marketplace_listing_title":"([^"]*)"/);
            const priceMatch = jsonStr.match(/"listing_price":\s*\{[^}]*"amount":"?(\d+)"?/);
            const idMatch = jsonStr.match(/"id":"(\d+)"/);

            if (titleMatch && idMatch) {
              listings.push({
                id: idMatch[1],
                title: titleMatch[1],
                price: priceMatch ? parseInt(priceMatch[1]) / 100 : null, // Often in cents
                location: null,
                imageUrl: null,
                url: `https://www.facebook.com/marketplace/item/${idMatch[1]}`,
              });
            }
          } catch (e) {
            // Continue
          }
        }
      }
    }
  }

  // Strategy 2: Find listing IDs and titles via regex patterns
  // Look for patterns like: /marketplace/item/123456789
  const listingIdMatches = html.match(/\/marketplace\/item\/(\d+)/g) || [];
  const uniqueIds = [...new Set(listingIdMatches.map((m) => m.split("/").pop()))];

  console.log(`   Found ${uniqueIds.length} unique listing IDs`);

  // Strategy 3: Extract from the DataFeed schema
  const dataFeedMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?DataFeed[\s\S]*?)<\/script>/i);
  if (dataFeedMatch) {
    try {
      // Try to find the actual content
      const jsonContent = dataFeedMatch[1].replace(/<[^>]*>/g, "").trim();
      const dataFeed = JSON.parse(jsonContent);
      if (dataFeed.dataFeedElement) {
        console.log(`   Found DataFeed with ${dataFeed.dataFeedElement.length} elements`);
      }
    } catch (e) {
      console.log(`   DataFeed parsing failed: ${e}`);
    }
  }

  // Strategy 4: Parse the raw HTML for listing cards
  // Look for listing title patterns
  const titleMatches = html.match(/"marketplace_listing_title":"([^"]+)"/g) || [];
  console.log(`   Found ${titleMatches.length} title matches`);

  for (const match of titleMatches) {
    const title = match.match(/"marketplace_listing_title":"([^"]+)"/)?.[1];
    if (title && !listings.some((l) => l.title === title)) {
      listings.push({
        id: `unknown-${listings.length}`,
        title: title,
        price: null,
        location: null,
        imageUrl: null,
        url: "",
      });
    }
  }

  // Strategy 5: Extract price/listing pairs
  // Pattern: "id":"123456789"..."marketplace_listing_title":"Title"..."listing_price":{"amount":"12345"
  const fullListingPattern =
    /"id":"(\d{10,})"[\s\S]{0,500}?"marketplace_listing_title":"([^"]+)"[\s\S]{0,200}?"listing_price":\{[^}]*"amount":"?(\d+)"?/g;
  let match;

  while ((match = fullListingPattern.exec(html)) !== null) {
    const [_, id, title, amount] = match;
    const existingIndex = listings.findIndex((l) => l.id === id);

    const listing: ExtractedListing = {
      id,
      title,
      price: parseInt(amount) / 100, // Convert cents to dollars
      location: null,
      imageUrl: null,
      url: `https://www.facebook.com/marketplace/item/${id}`,
    };

    // Try to parse year/make/model from title
    const ymm = parseVehicleFromTitle(title);
    if (ymm) {
      listing.year = ymm.year;
      listing.make = ymm.make;
      listing.model = ymm.model;
    }

    if (existingIndex >= 0) {
      listings[existingIndex] = { ...listings[existingIndex], ...listing };
    } else {
      listings.push(listing);
    }
  }

  return listings;
}

function parseVehicleFromTitle(title: string): { year?: number; make?: string; model?: string } | null {
  // Pattern: "2019 Toyota Camry" or "1965 Ford Mustang"
  const yearMatch = title.match(/^(\d{4})\s+/);
  if (!yearMatch) return null;

  const year = parseInt(yearMatch[1]);
  const rest = title.substring(5).trim();

  // Common makes
  const makes = [
    "Toyota", "Ford", "Chevrolet", "Chevy", "Honda", "Nissan", "BMW", "Mercedes",
    "Audi", "Porsche", "Volkswagen", "VW", "Dodge", "Jeep", "GMC", "Cadillac",
    "Lincoln", "Buick", "Pontiac", "Oldsmobile", "Plymouth", "Chrysler",
    "Mazda", "Subaru", "Lexus", "Acura", "Infiniti", "Hyundai", "Kia",
    "Volvo", "Jaguar", "Land Rover", "Mini", "Fiat", "Alfa Romeo",
  ];

  for (const make of makes) {
    if (rest.toLowerCase().startsWith(make.toLowerCase())) {
      const model = rest.substring(make.length).trim().split(/\s+/).slice(0, 2).join(" ");
      return { year, make, model };
    }
  }

  // Fallback: first word is make, second is model
  const words = rest.split(/\s+/);
  if (words.length >= 2) {
    return { year, make: words[0], model: words[1] };
  }

  return { year };
}

async function testExtraction() {
  console.log("🚀 Facebook Marketplace Listing Extractor");
  console.log("=========================================\n");

  const locations = ["austin", "losangeles", "miami", "chicago", "denver"];

  const allListings: ExtractedListing[] = [];

  for (const location of locations) {
    console.log(`\n📍 Location: ${location}`);

    try {
      const html = await fetchMarketplacePage(location);
      console.log(`   HTML size: ${(html.length / 1024).toFixed(1)}KB`);

      const listings = extractListingsFromHTML(html);
      console.log(`   Extracted ${listings.length} listings`);

      // Show sample
      const withPrices = listings.filter((l) => l.price && l.price > 0);
      console.log(`   With prices: ${withPrices.length}`);

      if (withPrices.length > 0) {
        console.log(`\n   Sample listings:`);
        for (const listing of withPrices.slice(0, 5)) {
          console.log(`   - ${listing.title}`);
          console.log(`     Price: $${listing.price?.toLocaleString()}`);
          console.log(`     ID: ${listing.id}`);
          if (listing.year) {
            console.log(`     Parsed: ${listing.year} ${listing.make} ${listing.model}`);
          }
        }
      }

      allListings.push(...listings);

      // Rate limit
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  // Summary
  console.log("\n\n📊 Summary");
  console.log("==========");
  console.log(`Total listings extracted: ${allListings.length}`);
  console.log(`With prices: ${allListings.filter((l) => l.price).length}`);
  console.log(`With year/make/model: ${allListings.filter((l) => l.year).length}`);

  // Filter to vintage (1960-1999)
  const vintage = allListings.filter((l) => l.year && l.year >= 1960 && l.year <= 1999);
  console.log(`Vintage (1960-1999): ${vintage.length}`);

  // Save results
  await fs.writeFile(
    "/Users/skylar/nuke/scripts/fb-marketplace-tests/extracted_listings.json",
    JSON.stringify(allListings, null, 2)
  );
  console.log("\n💾 Saved to extracted_listings.json");

  if (vintage.length > 0) {
    console.log("\n🚗 Vintage Vehicles Found:");
    for (const v of vintage.slice(0, 10)) {
      console.log(`   ${v.year} ${v.make} ${v.model} - $${v.price?.toLocaleString() || "N/A"}`);
    }
  }
}

testExtraction().catch(console.error);
