#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const pdfParse = require('pdf-parse');

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';
const GEMINI_API_KEY = 'AIzaSyCTXqzxp5oRPoW745dHZjGDQ2yFOd4fvDQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const PDF_URL = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/reference-docs/lmc%20catalog/ccComplete.pdf';

async function extractPartsFromText(text, pageNumbers, catalogId) {
  const prompt = `Extract ALL parts from this LMC Truck catalog text.

For each part, extract:
- Part Number
- Name
- Price
- Years
  
Return JSON:
{"parts": [{"part_number": "38-9630", "name": "Bumper Bolt Kit", "price": "24.95", "years": "73-87"}]}

Text:
${text.substring(0, 8000)}`; // Limit to avoid huge prompts

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
  console.log('LMC CATALOG INDEXING');
  console.log('='.repeat(60));

  console.log('\n1. Downloading PDF...');
  const pdfResp = await fetch(PDF_URL);
  const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
  console.log(`   Size: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  console.log('\n2. Parsing PDF (this may take 1-2 minutes)...');
  const pdfData = await pdfParse(pdfBuffer);
  console.log(`   Pages: ${pdfData.numpages}`);
  console.log(`   Text length: ${pdfData.text.length} chars`);

  console.log('\n3. Creating catalog record...');
  const { data: catalog, error: catError } = await supabase
    .from('catalog_sources')
    .upsert({
      name: 'LMC Truck Complete Catalog',
      provider: 'LMC',
      base_url: PDF_URL
    }, { onConflict: 'base_url' })
    .select()
    .single();

  if (catError) throw catError;
  const catalogId = catalog.id;
  console.log(`   Catalog ID: ${catalogId}`);

  console.log('\n4. Extracting parts (10 pages at a time)...');
  
  const charsPerPage = Math.floor(pdfData.text.length / pdfData.numpages);
  let totalParts = 0;
  const pagesPerBatch = 10;

  for (let page = 1; page <= pdfData.numpages; page += pagesPerBatch) {
    const endPage = Math.min(page + pagesPerBatch - 1, pdfData.numpages);
    const startIdx = (page - 1) * charsPerPage;
    const endIdx = endPage * charsPerPage;
    const textChunk = pdfData.text.substring(startIdx, endIdx);

    if (textChunk.trim().length < 100) continue;

    console.log(`\nPages ${page}-${endPage}...`);
    const parts = await extractPartsFromText(textChunk, Array.from({length: pagesPerBatch}, (_, i) => page + i), catalogId);
    totalParts += parts.length;

    await new Promise(r => setTimeout(r, 3000)); // Rate limit

    // Stop after 5 batches for testing
    if (page > 50) {
      console.log('\n[Test mode: Stopping after 50 pages]');
      break;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`INDEXED: ${totalParts} parts`);
}

main().catch(console.error);

