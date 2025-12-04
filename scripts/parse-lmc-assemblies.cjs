#!/usr/bin/env node
/**
 * PARSE LMC ASSEMBLY PAGES
 * Extracts callout mappings from assembly pages with numbered diagrams
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function parseAssemblyPage(url) {
  console.log(`\n📄 Parsing: ${url}`);
  
  try {
    // Scrape with Firecrawl
    const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html']
      })
    });

    if (!resp.ok) {
      console.log(`   ❌ HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const html = data.data?.html || '';
    const markdown = data.data?.markdown || '';

    // Extract slug from URL
    const slug = url.split('/').pop() || url.split('/').slice(-2, -1)[0];
    const assemblyName = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // Extract main assembly image (skip logos)
    const allImages = [...html.matchAll(/https:\/\/lmcnopstorage\.blob\.core\.windows\.net\/nopprodimages\/[^"<> ]*\.(?:png|jpg|jpeg)/gi)];
    const assemblyImage = allImages.find(m => !m[0].includes('logo') && !m[0].includes('0000020'))?.[0];

    if (!assemblyImage) {
      console.log(`   ⚠️  No assembly image found`);
      return null;
    }

    console.log(`   🖼️  Image: ${assemblyImage.substring(0, 70)}...`);

    // Parse parts table from markdown
    // Format: | # | Part Number | Name | Fits | Qty | Price | Stock |
    const tableMatches = [...markdown.matchAll(/\|\s*(\d+)\s*\|\s*([\d-]+(?:-[A-Z]+)?)\s*\|([^|]+)\|[^|]+\|\s*(?:Required Quantity:)?(?:<br>)?\s*\((\d+)\)\s*\|\s*\$?([\d.]+)/g)];

    const parts = tableMatches.map(match => ({
      callout: parseInt(match[1]),
      part_number: match[2].trim(),
      name: match[3].trim(),
      quantity: parseInt(match[4]),
      price: parseFloat(match[5])
    }));

    console.log(`   📦 Parts found: ${parts.length}`);
    
    if (parts.length === 0) {
      console.log(`   ⚠️  No parts table found`);
      return null;
    }

    // Show sample
    parts.slice(0, 3).forEach(p => {
      console.log(`      #${p.callout}: ${p.part_number} - ${p.name} (${p.quantity}x)`);
    });

    return {
      slug,
      name: assemblyName,
      image: assemblyImage,
      url,
      parts
    };

  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function saveAssembly(assemblyData) {
  console.log(`\n💾 Saving assembly: ${assemblyData.name}`);

  // Create assembly record
  const { data: assembly, error: assemblyError } = await supabase
    .from('part_assemblies')
    .upsert({
      slug: assemblyData.slug,
      name: assemblyData.name,
      assembly_image_url: assemblyData.image,
      source_url: assemblyData.url,
      total_parts_count: assemblyData.parts.length
    }, { onConflict: 'slug' })
    .select()
    .single();

  if (assemblyError) {
    console.log(`   ❌ Assembly error: ${assemblyError.message}`);
    return 0;
  }

  console.log(`   ✅ Assembly ID: ${assembly.id}`);

  // Create callout mappings
  let mapped = 0;
  
  for (const part of assemblyData.parts) {
    // Find part in catalog
    const { data: catalogParts } = await supabase
      .from('catalog_parts')
      .select('id')
      .eq('part_number', part.part_number)
      .limit(1);

    if (catalogParts && catalogParts.length > 0) {
      const { error: calloutError } = await supabase
        .from('assembly_callouts')
        .upsert({
          assembly_id: assembly.id,
          part_id: catalogParts[0].id,
          callout_number: part.callout,
          quantity: part.quantity,
          role: part.callout === 1 ? 'primary' : (part.price < 5 ? 'hardware' : 'component')
        }, { onConflict: 'assembly_id,callout_number' });

      if (!calloutError) {
        mapped++;
      }
    }
  }

  console.log(`   ✅ Mapped: ${mapped}/${assemblyData.parts.length} parts`);
  return mapped;
}

async function main() {
  console.log('='.repeat(70));
  console.log('🔧 LMC ASSEMBLY PARSER');
  console.log('='.repeat(70));

  // Get unique assembly URLs from parts that have images
  console.log('\n📊 Finding assembly pages...');
  
  const { data: parts } = await supabase
    .from('catalog_parts')
    .select('supplier_url, product_image_url')
    .not('supplier_url', 'is', null)
    .not('product_image_url', 'is', null);

  const uniqueUrls = [...new Set(parts.map(p => p.supplier_url))];
  
  console.log(`   Found ${uniqueUrls.length} unique assembly pages\n`);

  let assembliesCreated = 0;
  let totalPartsMapped = 0;

  for (let i = 0; i < uniqueUrls.length; i++) {
    console.log(`[${i + 1}/${uniqueUrls.length}]`);
    
    const assemblyData = await parseAssemblyPage(uniqueUrls[i]);
    
    if (assemblyData) {
      const mapped = await saveAssembly(assemblyData);
      
      if (mapped > 0) {
        assembliesCreated++;
        totalPartsMapped += mapped;
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 PARSING COMPLETE');
  console.log('='.repeat(70));
  console.log(`   Assemblies created: ${assembliesCreated}`);
  console.log(`   Parts mapped: ${totalPartsMapped}`);
  console.log(`   Average parts per assembly: ${(totalPartsMapped / assembliesCreated).toFixed(1)}`);
  console.log('='.repeat(70));
}

main().catch(console.error);

