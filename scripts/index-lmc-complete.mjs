#!/usr/bin/env node
/**
 * COMPLETE LMC CATALOG INDEXING
 * Extracts ALL data: parts, prices, categories, page references, sections
 */

import { createClient } from '@supabase/supabase-js';
import { default as pdfParse } from 'pdf-parse';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const PDF_URL = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/reference-docs/lmc%20catalog/ccComplete.pdf';

// Category keywords to detect sections
const CATEGORY_PATTERNS = {
  'Interior': ['interior', 'dash', 'seat', 'door panel', 'carpet', 'headliner', 'console'],
  'Exterior': ['exterior', 'bumper', 'grille', 'fender', 'hood', 'door', 'bed', 'tailgate', 'trim'],
  'Engine': ['engine', 'motor', 'cylinder', 'carburetor', 'fuel pump', 'water pump', 'alternator'],
  'Drivetrain': ['transmission', 'transfer case', 'axle', 'driveshaft', 'differential'],
  'Suspension': ['suspension', 'spring', 'shock', 'control arm', 'ball joint', 'tie rod'],
  'Brakes': ['brake', 'rotor', 'caliper', 'master cylinder', 'brake line'],
  'Electrical': ['electrical', 'wiring', 'switch', 'gauge', 'light', 'battery', 'ignition'],
  'Cooling': ['cooling', 'radiator', 'fan', 'thermostat', 'hose'],
  'Exhaust': ['exhaust', 'muffler', 'pipe', 'catalytic'],
  'Body': ['body', 'panel', 'weatherstrip', 'seal', 'molding'],
  'Apparel': ['shirt', 't-shirt', 'hat', 'jacket', 'sweatshirt', 'apparel', 'clothing'],
  'Decals': ['decal', 'sticker', 'emblem', 'badge', 'stripe']
};

function detectCategory(text) {
  const lowerText = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_PATTERNS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        return category;
      }
    }
  }
  return 'Other';
}

function extractYearRange(text) {
  // Match patterns like "73-87", "1973-1987", "73-79", etc.
  const patterns = [
    /(\d{2})-(\d{2})/g,  // 73-87
    /(\d{4})-(\d{4})/g,  // 1973-1987
    /(\d{2})\/(\d{2})/g  // 73/87
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const [_, start, end] = match[0].match(/(\d+)-(\d+)/) || match[0].match(/(\d+)\/(\d+)/) || [];
      if (start && end) {
        let yearStart = parseInt(start);
        let yearEnd = parseInt(end);
        
        // Convert 2-digit years to 4-digit
        if (yearStart < 100) yearStart += 1900;
        if (yearEnd < 100) yearEnd += 1900;
        
        return { yearStart, yearEnd };
      }
    }
  }
  
  return { yearStart: 1973, yearEnd: 1987 }; // Default range
}

function extractModels(text) {
  const models = [];
  const modelPatterns = ['C10', 'C20', 'C30', 'K10', 'K20', 'K30', 'Blazer', 'Suburban', 'Jimmy'];
  
  for (const model of modelPatterns) {
    if (text.toUpperCase().includes(model)) {
      models.push(model);
    }
  }
  
  return models.length > 0 ? models : ['C10', 'K10']; // Default models
}

async function extractPartsFromPageText(text, pageNumber, catalogId, pageId) {
  const prompt = `Extract ALL parts from this LMC Truck catalog page.

For each part listed, extract:
- Part Number (format: XX-XXXX)
- Name/Description
- Price (if shown)
- Year range (e.g., "73-87")
- Any notes about fitment

Return JSON array:
{
  "parts": [
    {
      "part_number": "38-9630",
      "name": "Bumper Bolt Kit",
      "description": "Complete bolt kit for front bumper installation",
      "price": "24.95",
      "years": "73-87",
      "notes": "Chrome finish"
    }
  ]
}

Page text:
${text.substring(0, 6000)}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          response_mime_type: "application/json",
          temperature: 0
        }
      })
    });

    if (!response.ok) {
      console.log(`    ⚠️  Gemini error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const extracted = JSON.parse(data.candidates[0].content.parts[0].text);
    
    console.log(`    ✅ Found: ${extracted.parts?.length || 0} parts`);

    if (extracted.parts && extracted.parts.length > 0) {
      for (const part of extracted.parts) {
        const yearRange = extractYearRange(part.years || '73-87');
        const models = extractModels(part.years || part.name);
        const category = detectCategory(part.name);
        
        try {
          await supabase.from('catalog_parts').insert({
            catalog_id: catalogId,
            page_id: pageId,
            part_number: part.part_number,
            name: part.name,
            description: part.description || part.notes,
            price_current: part.price ? parseFloat(String(part.price).replace(/[^0-9.]/g, '')) : null,
            category: category,
            year_start: yearRange.yearStart,
            year_end: yearRange.yearEnd,
            fits_models: models,
            application_data: {
              years: part.years,
              page: pageNumber,
              notes: part.notes
            }
          });
        } catch (insertError) {
          console.log(`    ⚠️  Insert error for ${part.part_number}:`, insertError.message);
        }
      }
    }

    return extracted.parts || [];
  } catch (e) {
    console.error(`    ❌ Error:`, e.message);
    return [];
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 COMPLETE LMC CATALOG INDEXING');
  console.log('='.repeat(70));

  console.log('\n📥 Step 1: Downloading PDF...');
  const pdfResp = await fetch(PDF_URL);
  const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
  console.log(`   Size: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  console.log('\n📄 Step 2: Parsing PDF...');
  const pdfData = await pdfParse(pdfBuffer);
  console.log(`   Pages: ${pdfData.numpages}`);
  console.log(`   Text length: ${pdfData.text.length.toLocaleString()} characters`);

  console.log('\n📚 Step 3: Creating catalog source...');
  const { data: catalog } = await supabase
    .from('catalog_sources')
    .upsert({
      name: 'LMC Truck Complete Catalog',
      provider: 'LMC',
      base_url: PDF_URL
    }, { onConflict: 'base_url' })
    .select()
    .single();

  const catalogId = catalog.id;
  console.log(`   Catalog ID: ${catalogId}`);

  console.log('\n⚙️  Step 4: Processing pages...');
  console.log('   (Processing first 100 pages for initial run)');
  
  const charsPerPage = Math.floor(pdfData.text.length / pdfData.numpages);
  let totalParts = 0;
  const maxPages = Math.min(100, pdfData.numpages);

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const startIdx = (pageNum - 1) * charsPerPage;
    const endIdx = pageNum * charsPerPage;
    const pageText = pdfData.text.substring(startIdx, endIdx);

    if (pageText.trim().length < 50) {
      console.log(`\n📄 Page ${pageNum}: (Empty, skipping)`);
      continue;
    }

    console.log(`\n📄 Page ${pageNum}/${maxPages}...`);
    
    // Detect section/category for this page
    const category = detectCategory(pageText);
    console.log(`   Category: ${category}`);

    // Create/update catalog page record
    const { data: page } = await supabase
      .from('catalog_pages')
      .upsert({
        catalog_id: catalogId,
        page_number: pageNum,
        raw_text: pageText.substring(0, 5000), // Store sample
        section: category
      }, { onConflict: 'catalog_id,page_number' })
      .select()
      .single();

    // Extract parts from this page
    const parts = await extractPartsFromPageText(pageText, pageNum, catalogId, page.id);
    totalParts += parts.length;

    // Rate limit for Gemini API
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n' + '='.repeat(70));
  console.log(`✅ INDEXING COMPLETE`);
  console.log(`   Pages processed: ${maxPages}`);
  console.log(`   Parts indexed: ${totalParts}`);
  console.log('='.repeat(70));
  console.log('\n💡 To process remaining pages, remove maxPages limit in code');
}

main().catch(console.error);

