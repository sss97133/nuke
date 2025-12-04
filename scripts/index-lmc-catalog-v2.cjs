#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const pdfjsLib = require('pdfjs-dist');

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

async function extractPageText(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  return textContent.items.map(item => item.str).join(' ');
}

async function extractPartsFromText(text, pageNumbers, catalogId) {
  const prompt = `Extract ALL parts from this LMC Truck catalog page text.

For each part listed, extract:
- Part Number  
- Name/Description
- Price (if shown)
- Year range (e.g., "73-79")

Return JSON:
{"parts": [{"part_number": "38-9630", "name": "Bumper Bolt Kit", "price": "24.95", "years": "73-87"}]}

Text:
${text.substring(0, 6000)}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0 }
      })
    });

    if (!response.ok) {
      console.log(`    Gemini error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const extracted = JSON.parse(data.candidates[0].content.parts[0].text);
    
    console.log(`    Found: ${extracted.parts?.length || 0} parts`);

    if (extracted.parts) {
      for (const part of extracted.parts) {
        await supabase.from('catalog_parts').insert({
          catalog_id: catalogId,
          part_number: part.part_number,
          name: part.name,
          price_current: part.price ? parseFloat(String(part.price).replace(/[^0-9.]/g, '')) : null,
          application_data: { years: part.years, pages: pageNumbers }
        });
      }
    }

    return extracted.parts || [];
  } catch (e) {
    console.error(`    Error:`, e.message);
    return [];
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('LMC CATALOG INDEXING (PDF.js)');
  console.log('='.repeat(60));

  console.log('\n1. Downloading PDF...');
  const pdfResp = await fetch(PDF_URL);
  const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
  console.log(`   Size: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  console.log('\n2. Loading PDF...');
  const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
  const pdf = await loadingTask.promise;
  console.log(`   Pages: ${pdf.numPages}`);

  console.log('\n3. Creating catalog record...');
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

  console.log('\n4. Extracting parts (page by page)...');
  
  let totalParts = 0;

  // Process first 20 pages as a test
  for (let page = 1; page <= Math.min(20, pdf.numPages); page++) {
    console.log(`\nPage ${page}...`);
    const pageText = await extractPageText(pdf, page);
    
    if (pageText.trim().length < 50) {
      console.log('    (Empty or too short, skipping)');
      continue;
    }

    const parts = await extractPartsFromText(pageText, [page], catalogId);
    totalParts += parts.length;

    await new Promise(r => setTimeout(r, 2000)); // Rate limit
  }

  console.log('\n' + '='.repeat(60));
  console.log(`TEST COMPLETE: ${totalParts} parts indexed from first 20 pages`);
  console.log('Remove page limit in code to process all pages.');
}

main().catch(console.error);

