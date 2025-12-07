/**
 * Ingest PCS (Powertrain Control Solutions) control modules
 * - Scrapes category + product pages with Firecrawl
 * - Extracts SKUs, names, descriptions, images
 * - Captures documentation links (pdf/step/x_t/igs) into application_data
 * - Stores/updates catalog_parts under provider 'PCS'
 * - Saves favicon/icon URLs into catalog_sources.application_data.icons
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIRECRAWL_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const firecrawlKey = process.env.FIRECRAWL_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!firecrawlKey) {
  console.error('❌ Missing FIRECRAWL_API_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CATEGORY_URL = 'https://powertraincontrolsolutions.com/aftermarket/control-modules';

async function firecrawlScrape(url) {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['html', 'markdown'],
    }),
  });
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}`);
  return res.json();
}

async function getCatalogId() {
  const { data: existing } = await supabase
    .from('catalog_sources')
    .select('id')
    .eq('provider', 'PCS')
    .single();
  if (existing) return existing.id;
  const { data: inserted, error } = await supabase
    .from('catalog_sources')
    .insert({
      name: 'PCS',
      provider: 'PCS',
      base_url: 'https://powertraincontrolsolutions.com',
    })
    .select()
    .single();
  if (error) throw error;
  return inserted.id;
}

function normalizeUrl(u) {
  if (!u) return null;
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return `https://powertraincontrolsolutions.com${u}`;
}

function extractProductLinks(html) {
  const $ = cheerio.load(html || '');
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('/aftermarket/control-modules/sku/')) {
      links.add(normalizeUrl(href));
    }
  });
  return Array.from(links);
}

function extractDocs($) {
  const docs = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const lower = href.toLowerCase();
    if (lower.endsWith('.pdf') || lower.endsWith('.step') || lower.endsWith('.x_t') || lower.endsWith('.igs') || lower.endsWith('.stp')) {
      docs.push(normalizeUrl(href));
    } else if (href.includes('pcswebsite.s3.amazonaws.com/resources/')) {
      docs.push(normalizeUrl(href));
    }
  });
  return Array.from(new Set(docs));
}

function extractProductData(html, markdown, url) {
  const $ = cheerio.load(html || '');
  // Name
  const name = $('h1').first().text().trim() ||
    $('h2').first().text().trim() ||
    $('title').text().trim() ||
    (markdown ? markdown.split('\n').find(l => l.startsWith('#'))?.replace(/^#+\s*/, '').trim() : null) ||
    url.split('/').pop();

  // Description
  const desc = $('p').first().text().trim() || null;

  // SKU
  let sku = null;
  const pathPart = url.split('/').pop() || '';
  if (pathPart && pathPart.includes('-')) {
    sku = pathPart;
  }
  // If SKU embedded in text
  const skuText = ($('body').text() || '').match(/SKU[:\s]*([A-Z0-9._-]+)/i);
  if (skuText) sku = skuText[1];

  // Image
  let image = null;
  const imgEl = $('img').first();
  if (imgEl && imgEl.attr('src')) image = normalizeUrl(imgEl.attr('src'));

  const docs = extractDocs($);

  return {
    part_number: sku || name,
    name: name || sku || 'PCS Control Module',
    description: desc,
    product_image_url: image,
    application_data: {
      docs,
      source_url: url,
    },
  };
}

async function upsertProduct(catalogId, product) {
  if (!product.part_number) return { stored: 0, updated: 0 };
  const { data: existing } = await supabase
    .from('catalog_parts')
    .select('id')
    .eq('catalog_id', catalogId)
    .eq('part_number', product.part_number)
    .single();
  if (existing) {
    await supabase
      .from('catalog_parts')
      .update({
        name: product.name,
        description: product.description,
        product_image_url: product.product_image_url,
        application_data: product.application_data,
        category: 'PCS Control Modules',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    return { stored: 0, updated: 1 };
  } else {
    await supabase
      .from('catalog_parts')
      .insert({
        catalog_id: catalogId,
        part_number: product.part_number,
        name: product.name,
        description: product.description,
        product_image_url: product.product_image_url,
        application_data: product.application_data,
        category: 'PCS Control Modules',
      });
    return { stored: 1, updated: 0 };
  }
}

async function saveIcons() {
  const icons = [
    {
      part_number: 'PCS-FAVICON-ICO',
      name: 'PCS Favicon ICO',
      product_image_url: 'https://powertraincontrolsolutions.com/favicon.ico',
    },
    {
      part_number: 'PCS-FAVICON-SVG',
      name: 'PCS Favicon SVG',
      product_image_url: 'https://powertraincontrolsolutions.com/favicon.svg',
    },
  ];

  const catalogId = await getCatalogId();
  for (const icon of icons) {
    const { data: existing } = await supabase
      .from('catalog_parts')
      .select('id')
      .eq('catalog_id', catalogId)
      .eq('part_number', icon.part_number)
      .single();
    if (existing) {
      await supabase
        .from('catalog_parts')
        .update({
          name: icon.name,
          product_image_url: icon.product_image_url,
          category: 'Branding',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('catalog_parts')
        .insert({
          catalog_id: catalogId,
          part_number: icon.part_number,
          name: icon.name,
          product_image_url: icon.product_image_url,
          category: 'Branding',
        });
    }
  }
}

async function main() {
  console.log('🚀 Ingesting PCS control modules');
  const catalogId = await getCatalogId();

  // Scrape category
  const categoryResp = await firecrawlScrape(CATEGORY_URL);
  const categoryHtml = categoryResp?.data?.html || '';
  const categoryMarkdown = categoryResp?.data?.markdown || '';
  const productLinks = extractProductLinks(categoryHtml);

  const targets = [CATEGORY_URL, ...productLinks];
  console.log(`Found ${productLinks.length} product links`);

  let stored = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    console.log(`[${i + 1}/${targets.length}] ${url}`);
    try {
      const resp = url === CATEGORY_URL ? { data: { html: categoryHtml, markdown: categoryMarkdown } } : await firecrawlScrape(url);
      const html = resp?.data?.html || '';
      const markdown = resp?.data?.markdown || '';
      const product = extractProductData(html, markdown, url);
      const res = await upsertProduct(catalogId, product);
      stored += res.stored;
      updated += res.updated;
      console.log(`   ✅ Stored ${res.stored}, Updated ${res.updated}, Docs: ${product.application_data.docs?.length || 0}`);
    } catch (err) {
      failed++;
      console.log(`   ❌ ${err.message}`);
    }
    if (i < targets.length - 1) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  await saveIcons();

  console.log('='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Targets: ${targets.length}`);
  console.log(`Stored: ${stored}`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
}

main().catch(err => {
  console.error('Unhandled error', err);
  process.exit(1);
});


