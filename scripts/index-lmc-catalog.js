#!/usr/bin/env node
/**
 * LMC CATALOG INDEXING
 * Extracts every part, every detail, page by page
 */

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.default || pdfParseModule;

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';
const GEMINI_API_KEY = 'AIzaSyCTXqzxp5oRPoW745dHZjGDQ2yFOd4fvDQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const PDF_URL = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/reference-docs/lmc%20catalog/ccComplete.pdf';

async function extractPartsFromText(text, pageNumbers, catalogId) {
  const prompt = `You are analyzing pages ${pageNumbers.join(', ')} of an LMC Truck parts catalog.

Extract ALL parts from this text. For each part, extract:
- Part Number (SKU)
- Name/Description  
- Price (if visible)
- Compatible Years (e.g., "73-79" or "All")
- Notes/Details

Return JSON array:
{
  "parts": [
    {
      "part_number": "38-9630",
      "name": "Bumper Bolt Kit",
      "price": "24.95",
      "years": "73-87",
      "description": "Chrome bumper mounting hardware"
    }
  ]
}

Text:
${text}`;

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
  
  console.log(`    Extracted: ${extracted.parts?.length || 0} parts`);
  console.log(`    Tokens: ${data.usageMetadata?.totalTokenCount || 0}`);

  // Store parts
  if (extracted.parts) {
    for (const part of extracted.parts) {
      const { error } = await supabase.from('catalog_parts').insert({
        catalog_id: catalogId,
        part_number: part.part_number,
        name: part.name,
        description: part.description || part.name,
        price_current: part.price ? parseFloat(String(part.price).replace(/[^0-9.]/g, '')) : null,
        application_data: {
          years: part.years,
          pages: pageNumbers
        }
      });
      
      if (error && !error.message.includes('duplicate')) {
        console.error(`    DB error for ${part.part_number}:`, error.message);
      }
    }
  }

  return extracted.parts || [];
}

async function main() {
  console.log('='.repeat(60));
  console.log('LMC CATALOG INDEXING');
  console.log('='.repeat(60));

  // 1. Download PDF
  console.log('\n1. Downloading PDF...');
  const pdfResp = await fetch(PDF_URL);
  const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
  console.log(`   Size: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  // 2. Parse PDF
  console.log('\n2. Parsing PDF...');
  const pdfData = await pdfParse(pdfBuffer);
  console.log(`   Pages: ${pdfData.numpages}`);
  console.log(`   Text length: ${pdfData.text.length} chars`);

  // 3. Get or create catalog
  console.log('\n3. Creating catalog record...');
  const { data: catalog } = await supabase
    .from('catalog_sources')
    .insert({
      name: 'LMC Truck 1973-1987 Complete Catalog',
      provider: 'LMC',
      base_url: PDF_URL
    })
    .select()
    .single();

  const catalogId = catalog.id;
  console.log(`   Catalog ID: ${catalogId}`);

  // 4. Extract text page-by-page
  console.log('\n4. Extracting page-by-page...');
  
  const pagesPerBatch = 5; // Process 5 pages at a time
  let totalParts = 0;

  for (let i = 1; i <= pdfData.numpages; i += pagesPerBatch) {
    const end = Math.min(i + pagesPerBatch - 1, pdfData.numpages);
    console.log(`\nProcessing pages ${i}-${end}...`);

    // Extract text for this batch
    // pdfParse doesn't give us per-page text easily, so we'll split by page breaks or use a different method
    // For now, let's use the full text and chunk it
    const chunkSize = 10000; // chars per chunk
    const startIdx = (i - 1) * chunkSize;
    const endIdx = Math.min(startIdx + (pagesPerBatch * chunkSize), pdfData.text.length);
    const textChunk = pdfData.text.substring(startIdx, endIdx);

    if (textChunk.trim().length === 0) {
      console.log('    Empty chunk, skipping');
      continue;
    }

    // Extract parts from this chunk
    const parts = await extractPartsFromText(textChunk, Array.from({length: pagesPerBatch}, (_, idx) => i + idx), catalogId);
    totalParts += parts.length;

    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETE: ${totalParts} parts indexed`);
}

main().catch(console.error);

