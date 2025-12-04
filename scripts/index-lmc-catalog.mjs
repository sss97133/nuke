#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PDF_URL = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/reference-docs/lmc%20catalog/ccComplete.pdf';


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function extractPageText(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  return textContent.items.map(item => item.str).join(' ');
}

async function extractParts(text, pages, catalogId) {
  const prompt = `Extract ALL parts from this LMC catalog page.
For each part: part_number, name, price, years.
Return JSON: {"parts": [{"part_number": "XX-XXXX", "name": "Part Name", "price": "19.95", "years": "73-87"}]}

Text:
${text.substring(0, 7000)}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json", temperature: 0 }
    })
  });

  if (!response.ok) {
    console.log(`  Gemini error: ${response.status}`);
    return [];
  }

  const data = await response.json();
  const extracted = JSON.parse(data.candidates[0].content.parts[0].text);
  
  if (extracted.parts) {
    console.log(`  Extracted: ${extracted.parts.length} parts`);
    for (const part of extracted.parts) {
      await supabase.from('catalog_parts').insert({
        catalog_id: catalogId,
        part_number: part.part_number,
        name: part.name,
        price_current: part.price ? parseFloat(String(part.price).replace(/[^0-9.]/g, '')) : null,
        application_data: { years: part.years, pages }
      });
    }
    return extracted.parts;
  }
  
  return [];
}

async function main() {
  console.log('='.repeat(60));
  console.log('LMC CATALOG INDEXING');
  console.log('='.repeat(60));

  console.log('\n1. Downloading PDF...');
  const pdfResp = await fetch(PDF_URL);
  const pdfArrayBuffer = await pdfResp.arrayBuffer();
  console.log(`   Size: ${(pdfArrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

  console.log('\n2. Loading PDF...');
  const pdf = await pdfjsLib.getDocument({ data: pdfArrayBuffer }).promise;
  console.log(`   Pages: ${pdf.numPages}`);

  console.log('\n3. Creating catalog...');
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
  console.log(`   ID: ${catalogId}`);

  console.log('\n4. Extracting parts...');
  let totalParts = 0;

  // Process first 30 pages to test
  for (let page = 1; page <= Math.min(30, pdf.numPages); page++) {
    console.log(`\nPage ${page}/${pdf.numPages}...`);
    const text = await extractPageText(pdf, page);
    
    if (text.trim().length < 50) {
      console.log('  (Too short, skipping)');
      continue;
    }

    const parts = await extractParts(text, [page], catalogId);
    totalParts += parts.length;

    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`INDEXED: ${totalParts} parts from first 30 pages`);
}

main().catch(console.error);

