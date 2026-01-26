#!/usr/bin/env node

/**
 * Directly update BaT vehicle with comprehensive data extraction
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env.local');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  // .env.local not found
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function extractBaTData(url) {
  console.log(`\n🔍 Fetching BaT listing: ${url}`);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }
  
  const html = await response.text();
  const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  
  const data = {};
  
  // Extract description - look for main content paragraph
  const descPatterns = [
    /<p[^>]*>This\s+\d{4}[^<]+<\/p>/i,
    /<div[^>]*class="post-content"[^>]*>([\s\S]{200,2000}?)<\/div>/i,
    /<div[^>]*class="listing-description"[^>]*>([\s\S]{200,2000}?)<\/div>/i
  ];
  
  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match) {
      const descText = match[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || match[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (descText.length > 50) {
        data.description = descText.substring(0, 2000);
        break;
      }
    }
  }
  
  // Fallback: extract first substantial paragraph
  if (!data.description) {
    const paragraphs = html.match(/<p[^>]*>([^<]{100,500})<\/p>/gi);
    if (paragraphs && paragraphs.length > 0) {
      const firstPara = paragraphs[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (firstPara.length > 50) {
        data.description = firstPara.substring(0, 2000);
      }
    }
  }
  
  // Extract mileage - "89k Miles", "31k Miles Shown"
  const mileagePatterns = [
    /(\d+(?:,\d+)?)\s*k\s*Miles?\s*(?:Shown)?/i,
    /(\d+(?:,\d+)?)\s*Miles?\s*Shown/i,
    /Odometer[:\s]*(\d+(?:,\d+)?)\s*k?/i
  ];
  for (const pattern of mileagePatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      let miles = parseInt(match[1].replace(/,/g, ''));
      if (match[0].toLowerCase().includes('k')) {
        miles = miles * 1000;
      }
      if (miles > 0 && miles < 10000000) {
        data.mileage = miles;
        break;
      }
    }
  }
  
  // Extract price - "Current Bid: USD $23,000"
  const priceMatch = bodyText.match(/Current\s+Bid[:\s]*USD\s*\$?([\d,]+)/i);
  if (priceMatch) {
    data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''));
  }
  
  // Extract color - "finished in Golf Blue"
  const colorMatch = bodyText.match(/finished\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
  if (colorMatch) {
    data.color = colorMatch[1].trim();
  }
  
  // Extract engine - "1,720cc flat-four"
  const engineMatch = bodyText.match(/(\d+(?:,\d+)?)\s*cc\s+([a-z-]+)/i);
  if (engineMatch) {
    data.engine_type = `${engineMatch[1]}cc ${engineMatch[2]}`.trim();
  }
  
  // Extract transmission - "five-speed manual transaxle", "5-Speed"
  const transMatch = bodyText.match(/(\d+)[-\s]*Speed\s+(Manual|Automatic)/i) ||
                    bodyText.match(/(five|four|three|six|seven|eight)[-\s]*speed\s+(manual|automatic)/i) ||
                    bodyText.match(/(Manual|Automatic)\s+transaxle/i);
  if (transMatch) {
    if (transMatch[1] && transMatch[2]) {
      const speed = transMatch[1].toLowerCase().includes('five') ? '5' : 
                   transMatch[1].toLowerCase().includes('four') ? '4' :
                   transMatch[1].toLowerCase().includes('six') ? '6' :
                   transMatch[1];
      data.transmission = `${speed}-Speed ${transMatch[2]}`;
    } else if (transMatch[1]) {
      data.transmission = transMatch[1];
    }
  }
  
  // Extract location
  const locationMatch = bodyText.match(/Located\s+in\s+([^.\n]+)/i);
  if (locationMatch) {
    data.location = locationMatch[1].trim();
  }
  
  return data;
}

async function updateVehicle(vehicleId) {
  console.log(`\n🔍 Updating vehicle ${vehicleId}...`);

  const { data: vehicle, error: fetchError } = await supabase
    .from('vehicles')
    .select('id, discovery_url')
    .eq('id', vehicleId)
    .single();

  if (fetchError || !vehicle) {
    console.error(`❌ Vehicle not found: ${fetchError?.message}`);
    return;
  }

  if (!vehicle.discovery_url) {
    console.error(`❌ No discovery_url`);
    return;
  }

  const extracted = await extractBaTData(vehicle.discovery_url);
  
  console.log(`\n✅ Extracted data:`);
  console.log(`   - Description: ${extracted.description ? extracted.description.substring(0, 100) + '...' : 'MISSING'}`);
  console.log(`   - Mileage: ${extracted.mileage || 'MISSING'}`);
  console.log(`   - Price: ${extracted.asking_price ? '$' + extracted.asking_price.toLocaleString() : 'MISSING'}`);
  console.log(`   - Color: ${extracted.color || 'MISSING'}`);
  console.log(`   - Engine: ${extracted.engine_type || 'MISSING'}`);
  console.log(`   - Transmission: ${extracted.transmission || 'MISSING'}`);
  console.log(`   - Location: ${extracted.location || 'MISSING'}`);

  const { error: updateError } = await supabase
    .from('vehicles')
    .update(extracted)
    .eq('id', vehicleId);

  if (updateError) {
    console.error(`❌ Update failed: ${updateError.message}`);
    return;
  }

  console.log(`\n✅ Vehicle updated!`);
}

async function main() {
  const vehicleId = process.argv[2] || '1a693ca9-7de7-420e-acc5-4f922ffcb383';
  await updateVehicle(vehicleId);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

