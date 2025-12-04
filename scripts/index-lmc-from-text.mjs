#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

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

async function extractParts(text, catalogId) {
  const prompt = `Extract ALL parts from this LMC catalog text. Be thorough and extract every single part number you see.

For each part:
{
  "part_number": "XX-XXXX",
  "name": "Part Name",
  "price": "19.95",
  "years": "73-87",
  "description": "Full description"
}

Return: {"parts": [...]}

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
    const err = await response.text();
    throw new Error(`Gemini error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const extracted = JSON.parse(data.candidates[0].content.parts[0].text);
  
  console.log(`    Gemini found: ${extracted.parts?.length || 0} parts`);
  console.log(`    Tokens: ${data.usageMetadata?.totalTokenCount || 0} (Cost: ~$${((data.usageMetadata?.totalTokenCount || 0) / 1000000 * 0.35).toFixed(4)})`);

  // Store in DB
  if (extracted.parts) {
    for (const part of extracted.parts) {
      const { error } = await supabase.from('catalog_parts').insert({
        catalog_id: catalogId,
        part_number: part.part_number,
        name: part.name,
        description: part.description || part.name,
        price_current: part.price ? parseFloat(String(part.price).replace(/[^0-9.]/g, '')) : null,
        application_data: { years: part.years }
      });
      
      if (error && !error.message.includes('duplicate')) {
        console.error(`    Error storing ${part.part_number}:`, error.message);
      }
    }
  }

  return extracted.parts || [];
}

async function main() {
  console.log('='.repeat(60));
  console.log('LMC CATALOG INDEXING FROM TEXT');
  console.log('='.repeat(60));

  console.log('\n1. Reading extracted text...');
  const fullText = readFileSync('/tmp/lmc.txt', 'utf-8');
  console.log(`   Lines: ${fullText.split('\n').length}`);
  console.log(`   Length: ${fullText.length} chars`);

  console.log('\n2. Creating catalog...');
  const { data: existing } = await supabase
    .from('catalog_sources')
    .select('id')
    .eq('base_url', 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/reference-docs/lmc%20catalog/ccComplete.pdf')
    .single();

  let catalogId;
  if (existing) {
    catalogId = existing.id;
  } else {
    const { data: newCatalog } = await supabase
      .from('catalog_sources')
      .insert({
        name: 'LMC Truck Complete Catalog',
        provider: 'LMC',
        base_url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/reference-docs/lmc%20catalog/ccComplete.pdf'
      })
      .select()
      .single();
    catalogId = newCatalog.id;
  }
  console.log(`   Catalog ID: ${catalogId}`);

  console.log('\n3. Extracting parts in chunks...');
  
  const chunkSize = 15000; // chars per chunk
  let totalParts = 0;
  let chunkNum = 0;

  for (let i = 0; i < fullText.length; i += chunkSize) {
    chunkNum++;
    const chunk = fullText.substring(i, i + chunkSize);
    
    console.log(`\nChunk ${chunkNum} (chars ${i}-${i + chunkSize})...`);
    
    try {
      const parts = await extractParts(chunk, catalogId);
      totalParts += parts.length;
    } catch (e) {
      console.error(`  Error: ${e.message.substring(0, 100)}`);
      // Continue on error
    }

    await new Promise(r => setTimeout(r, 2000)); // Rate limit (reduced for speed)
  }

  console.log('\n' + '='.repeat(60));
  console.log(`INDEXED: ${totalParts} parts from ${chunkNum} chunks`);
}

main().catch(console.error);

