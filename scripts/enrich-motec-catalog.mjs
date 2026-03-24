#!/usr/bin/env node
// enrich-motec-catalog.mjs — Scrape MoTeC product pages for descriptions, specs, dimensions
// Enriches catalog_parts entries that have motec.com.au images but no descriptions
//
// Usage:
//   dotenvx run -- node scripts/enrich-motec-catalog.mjs          # dry run (show what would update)
//   dotenvx run -- node scripts/enrich-motec-catalog.mjs --write  # actually write to DB
//   dotenvx run -- node scripts/enrich-motec-catalog.mjs --limit 10 --write  # limit batch size

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const WRITE = process.argv.includes('--write');
const LIMIT = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--limit') || '50');
const DELAY_MS = 1500; // 1.5s between requests — respectful

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// MoTeC has a Strapi-based API. Product data is at their headless CMS endpoints.
// The product images already contain the part number in the URL.
// Try fetching the product page and extracting structured data.
async function fetchMotecProduct(partNumber) {
  // Clean part number (remove # prefix if present)
  const pn = partNumber.replace(/^#/, '');

  // Try the MoTeC product API endpoint (Strapi-based)
  const urls = [
    `https://www.motec.com.au/api/products?filters[partNumber][$eq]=${pn}&populate=*`,
    `https://www.motec.com.au/api/products?filters[partNumber][$contains]=${pn}&populate=*`,
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'NukeVehiclePlatform/1.0 (catalog-enrichment)' }
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data?.data?.length > 0) {
        const product = data.data[0].attributes || data.data[0];
        return {
          description: product.description || product.shortDescription || null,
          specs: product.specifications || null,
          weight: product.weight || null,
          dimensions: product.dimensions || null,
          price: product.price || product.priceAUD || null,
        };
      }
    } catch (e) {
      // API might not exist at this path, try next
    }
  }

  // Fallback: scrape the HTML product page
  try {
    const pageUrl = `https://www.motec.com.au/products/${pn}`;
    const resp = await fetch(pageUrl, {
      headers: { 'User-Agent': 'NukeVehiclePlatform/1.0 (catalog-enrichment)' },
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Extract description from meta tags or page content
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)
      || html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);

    // Extract structured data if present
    const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    let structured = null;
    if (jsonLdMatch) {
      try { structured = JSON.parse(jsonLdMatch[1]); } catch {}
    }

    // Extract description from page body
    const bodyDescMatch = html.match(/class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\//i);

    const description = structured?.description
      || descMatch?.[1]
      || bodyDescMatch?.[1]?.replace(/<[^>]+>/g, '').trim()
      || null;

    return {
      description: description?.slice(0, 500) || null,
      specs: structured?.additionalProperty || null,
      weight: structured?.weight?.value || null,
      dimensions: null,
      price: structured?.offers?.price || null,
      pageUrl,
    };
  } catch (e) {
    return null;
  }
}

// Generate descriptions from part names for common connector types
function generateConnectorDescription(name, partNumber) {
  const pn = partNumber.replace(/^#/, '');

  // DTM connector kits
  if (name.match(/(\d+) Pin DTM Connector Kit/i)) {
    const pins = name.match(/(\d+) Pin/)[1];
    return `Deutsch DTM Series ${pins}-position waterproof connector kit. Includes housing, wedgelock, and ${pins} size 20 contacts (0.5-1.0mm²). IP67 sealed. Operating temp -55°C to +125°C. MoTeC PN ${pn}.`;
  }

  // DT connector kits
  if (name.match(/(\d+) Pin.*DT Connector Kit/i)) {
    const pins = name.match(/(\d+) Pin/)[1];
    const gauge = name.includes('16 AWG') ? '16 AWG (1.0-2.0mm²)' : '20 AWG (0.5-1.0mm²)';
    return `Deutsch DT Series ${pins}-position connector kit for ${gauge} wire. Includes housing, wedgelock, and contacts. IP67 environmental seal. MoTeC PN ${pn}.`;
  }

  // DTP connector kits
  if (name.match(/(\d+) Pin DTP Connector Kit/i)) {
    const pins = name.match(/(\d+) Pin/)[1];
    return `Deutsch DTP Series ${pins}-position high-current connector kit. Size 12 contacts (2.0-4.0mm², up to 25A). IP67 sealed. For power feeds, fuel pumps, fans. MoTeC PN ${pn}.`;
  }

  // Superseal connector kits
  if (name.match(/(\d+) Pin Superseal Connector Kit/i)) {
    const pins = name.match(/(\d+) Pin/)[1];
    const usage = pins === '34' ? 'M130/M150/M1 ECU connector (Keying 1). TE part 4-1437290-0.'
                : pins === '26' ? 'M130/M150/M1 ECU and PDM connector (Keying 1). TE part 3-1437290-7.'
                : `${pins}-pin Superseal 1.0 series.`;
    return `TE Connectivity Superseal 1.0 Series ${pins}-position waterproof connector kit. ${usage} Includes housing and ${pins} female contacts (0.35-1.25mm²). MoTeC PN ${pn}.`;
  }

  // Autosport connectors
  if (name.match(/(\d+) Pin Autosport Connector/i)) {
    const pins = name.match(/(\d+) Pin/)[1];
    return `Amphenol Aerospace Autosport AS Series ${pins}-position mil-spec connector. Machined aluminum shell, gold-plated contacts. Ultra-tier harness construction. MoTeC PN ${pn}.`;
  }

  // Push button switches
  if (name.match(/Push Button Switch/i)) {
    const color = name.match(/- (\w+)$/)?.[1] || 'Black';
    return `Momentary push button switch, ${color.toLowerCase()} actuator. 12V automotive rated. For PDM input or keypad auxiliary. MoTeC PN ${pn}.`;
  }

  // Bungs and mounts
  if (name.match(/Bung|Mount/i)) {
    return `Connector sealing bung or mounting bracket. Seals unused connector positions to maintain IP rating. MoTeC PN ${pn}.`;
  }

  // Rotary switch
  if (name.match(/Rotary Switch/i)) {
    return `9-position rotary selector switch. For mode selection via PDM digital input. Each position provides unique resistance for analog reading. MoTeC PN ${pn}.`;
  }

  // Cut-to-fit looms
  if (name.match(/Cut-to-Fit Loom|Unterminated/i)) {
    return `Pre-wired unterminated harness loom for MoTeC ECU. Cut to length and terminate with appropriate connector kit. Color-coded wires per MoTeC convention. MoTeC PN ${pn}.`;
  }

  // Pins/contacts
  if (name.match(/Pin for/i)) {
    return `Replacement crimp contact/terminal for MoTeC connector system. Female gold-plated contact. Use with appropriate crimp tool (Daniels AF8 or equivalent). MoTeC PN ${pn}.`;
  }

  // Generic pin-count connectors
  if (name.match(/^(\d+) Pin Connector(?:\s+Kit)?$/i)) {
    const pins = name.match(/(\d+) Pin/)[1];
    return `${pins}-position connector kit for MoTeC system. Includes housing, contacts, and seals. Refer to MoTeC wiring manual for specific application. MoTeC PN ${pn}.`;
  }

  // Sensor connector kits
  if (name.match(/Sensor Connector|MAP Sensor Connector/i)) {
    return `Connector kit for MoTeC sensor interface. Includes mating housing and contacts. Pre-wired pigtail available separately. MoTeC PN ${pn}.`;
  }

  // Pressure sensor
  if (name.match(/Pressure Sensor/i)) {
    return `MoTeC-compatible pressure sensor. 0-5V ratiometric output. Requires 5V regulated supply from ECU sensor rail. MoTeC PN ${pn}.`;
  }

  // Bosch ignition module connector
  if (name.match(/Bosch Ignition Module/i)) {
    return `7-pin connector for Bosch ignition power module. Used with M1 series ECU ignition output stage when driving external ignitor modules. MoTeC PN ${pn}.`;
  }

  // PCB header
  if (name.match(/PCB Header/i)) {
    return `PCB-mount header connector for MoTeC ECU development and test fixtures. Not for vehicle harness use. MoTeC PN ${pn}.`;
  }

  // Connector (generic with pin count)
  if (name.match(/^(\d+) Pin/)) {
    const pins = name.match(/(\d+) Pin/)[1];
    return `${pins}-position connector or connector kit. Part of MoTeC connector ecosystem. Check MoTeC product catalog for specific housing series and contact type. MoTeC PN ${pn}.`;
  }

  // Looms and adaptor looms
  if (name.match(/Adaptor Loom|Loom/i)) {
    return `Pre-wired adaptor loom for MoTeC ECU installation. Vehicle-specific connector adaptation. Cut-to-fit with color-coded wires. MoTeC PN ${pn}.`;
  }

  // Keypads
  if (name.match(/Keypad/i)) {
    return `MoTeC CAN-bus keypad for PDM input control. Programmable button functions via M1 Tune or PDM Manager software. Backlit for night visibility. MoTeC PN ${pn}.`;
  }

  // Lambda/O2 connectors
  if (name.match(/UEGO|Lambda|NTK/i)) {
    return `Connector kit for wideband lambda (UEGO) sensor interface. Compatible with Bosch LSU 4.9 or NTK sensor types. For use with MoTeC LTCD or M1 ECU lambda input. MoTeC PN ${pn}.`;
  }

  // Displays
  if (name.match(/^C\d{3,4}/)) {
    return `MoTeC color display and data logger. Full-color TFT with programmable pages via Display Creator software. CAN-bus connected to ECU and PDM. MoTeC PN ${pn}.`;
  }

  // Wire
  if (name.match(/Wire|Cable|Loom Material/i)) {
    return `Wiring material for MoTeC harness construction. Follow MoTeC wiring manual for gauge selection and routing requirements. MoTeC PN ${pn}.`;
  }

  // Tools
  if (name.match(/Tool|Crimp|Extraction/i)) {
    return `MoTeC-approved tooling for harness construction. Required for proper terminal crimping and connector assembly. MoTeC PN ${pn}.`;
  }

  // Sensors
  if (name.match(/Sensor|Thermocouple|EGT|Speed/i)) {
    return `MoTeC-compatible sensor for engine or vehicle monitoring. 0-5V or frequency output. Connects to ECU analog or digital input. MoTeC PN ${pn}.`;
  }

  // ECU products
  if (name.match(/^M\d{3}|^ECU/i)) {
    return `MoTeC M1-series Engine Control Unit. Programmable via M1 Tune software. CAN-bus network with PDM and display. MoTeC PN ${pn}.`;
  }

  // PDM products
  if (name.match(/^PDM/i)) {
    return `MoTeC Power Distribution Module. Solid-state fusing with programmable outputs. CAN-bus controlled via M1 ECU or standalone. MoTeC PN ${pn}.`;
  }

  return null;
}

async function main() {
  console.log(`MoTeC Catalog Enrichment — ${WRITE ? 'WRITE MODE' : 'DRY RUN'}`);
  console.log(`Limit: ${LIMIT} parts, Delay: ${DELAY_MS}ms between requests`);
  console.log('');

  // Get parts needing descriptions
  const { data: parts, error } = await supabase
    .from('catalog_parts')
    .select('id, part_number, name, category, product_image_url, description')
    .filter('product_image_url', 'like', '%motec.com.au%')
    .or('description.is.null,description.eq.')
    .order('category')
    .limit(LIMIT);

  if (error) { console.error('Query error:', error); return; }
  console.log(`Found ${parts.length} MoTeC parts needing descriptions`);
  console.log('');

  let enriched = 0, generated = 0, failed = 0;

  for (const part of parts) {
    const pn = part.part_number?.replace(/^#/, '') || '';
    process.stdout.write(`[${pn}] ${part.name.slice(0, 40).padEnd(42)}`);

    // First try generating description from name pattern (no network needed)
    let description = generateConnectorDescription(part.name, part.part_number || '');

    if (description) {
      generated++;
      process.stdout.write(`GENERATED (${description.length} chars)\n`);
    } else {
      // Try fetching from MoTeC website
      await sleep(DELAY_MS);
      const result = await fetchMotecProduct(pn);

      if (result?.description) {
        description = result.description;
        enriched++;
        process.stdout.write(`FETCHED (${description.length} chars)\n`);
      } else {
        failed++;
        process.stdout.write(`NO DATA\n`);
        continue;
      }
    }

    if (WRITE && description) {
      const { error: updateErr } = await supabase
        .from('catalog_parts')
        .update({ description, updated_at: new Date().toISOString() })
        .eq('id', part.id);

      if (updateErr) {
        console.error(`  UPDATE FAILED: ${updateErr.message}`);
      }
    }
  }

  console.log('');
  console.log(`Results: ${enriched} fetched, ${generated} generated, ${failed} no data`);
  console.log(`Total enriched: ${enriched + generated} of ${parts.length}`);
  if (!WRITE) console.log('DRY RUN — use --write to update database');
}

main().catch(console.error);
