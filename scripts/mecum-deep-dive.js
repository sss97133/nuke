#!/usr/bin/env node
/**
 * DEEP DIVE: Extract EVERYTHING from Mecum page
 * Looking for owner info, consignor, seller, collection, etc.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const URL = process.argv[2] || 'https://www.mecum.com/lots/550167/1978-pontiac-trans-am/';

async function deepDive() {
  console.log(`\n🔬 DEEP DIVE: ${URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture ALL network requests
  const apiCalls = [];
  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';

    if (contentType.includes('json') || url.includes('api') || url.includes('graphql')) {
      try {
        const text = await response.text();
        apiCalls.push({ url, contentType, data: text });
      } catch (e) {}
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // 1. Extract COMPLETE __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    return script ? JSON.parse(script.textContent) : null;
  });

  if (nextData) {
    // Save full JSON for analysis
    writeFileSync('/tmp/mecum-nextdata-full.json', JSON.stringify(nextData, null, 2));
    console.log('📁 Full __NEXT_DATA__ saved to /tmp/mecum-nextdata-full.json\n');

    const post = nextData.props?.pageProps?.post;

    if (post) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('                    ALL POST FIELDS                         ');
      console.log('═══════════════════════════════════════════════════════════\n');

      // Print ALL keys in post object
      const printObject = (obj, indent = 0) => {
        const prefix = '  '.repeat(indent);
        for (const [key, value] of Object.entries(obj || {})) {
          if (value === null || value === undefined || value === '' || value === false) continue;

          if (Array.isArray(value)) {
            if (value.length > 0) {
              console.log(`${prefix}${key}: [${value.length} items]`);
              if (typeof value[0] === 'object') {
                printObject(value[0], indent + 1);
              } else {
                console.log(`${prefix}  → ${value.slice(0, 3).join(', ')}${value.length > 3 ? '...' : ''}`);
              }
            }
          } else if (typeof value === 'object') {
            // Check for edges pattern (GraphQL)
            if (value.edges) {
              const items = value.edges.map(e => e.node);
              console.log(`${prefix}${key}: [${items.length} nodes]`);
              items.slice(0, 2).forEach(item => {
                if (typeof item === 'object') {
                  const summary = Object.entries(item)
                    .filter(([k, v]) => v && typeof v !== 'object')
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ');
                  console.log(`${prefix}  → ${summary}`);
                }
              });
            } else {
              console.log(`${prefix}${key}:`);
              printObject(value, indent + 1);
            }
          } else {
            const val = String(value).slice(0, 100);
            console.log(`${prefix}${key}: ${val}${String(value).length > 100 ? '...' : ''}`);
          }
        }
      };

      printObject(post);

      // Specifically look for owner/seller/consignor fields
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('              SEARCHING FOR OWNER/SELLER DATA               ');
      console.log('═══════════════════════════════════════════════════════════\n');

      const searchTerms = [
        'owner', 'seller', 'consign', 'dealer', 'collection', 'estate',
        'contact', 'phone', 'email', 'name', 'person', 'company',
        'vendor', 'client', 'customer', 'bidder', 'buyer', 'from',
        'title', 'registration', 'history', 'provenance', 'document'
      ];

      const findDeep = (obj, path = '', results = []) => {
        if (!obj || typeof obj !== 'object') return results;

        for (const [key, value] of Object.entries(obj)) {
          const currentPath = path ? `${path}.${key}` : key;
          const keyLower = key.toLowerCase();

          // Check if key matches search terms
          if (searchTerms.some(term => keyLower.includes(term))) {
            results.push({ path: currentPath, key, value });
          }

          // Check string values for patterns
          if (typeof value === 'string') {
            if (value.match(/collection|estate|from the|consign/i)) {
              results.push({ path: currentPath, key, value, reason: 'content match' });
            }
          }

          if (typeof value === 'object') {
            findDeep(value, currentPath, results);
          }
        }
        return results;
      };

      const ownerData = findDeep(nextData);
      ownerData.forEach(item => {
        const val = typeof item.value === 'object'
          ? JSON.stringify(item.value).slice(0, 200)
          : String(item.value).slice(0, 200);
        console.log(`📍 ${item.path}`);
        console.log(`   ${val}\n`);
      });

      // Look at lotFields specifically
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('                    LOT FIELDS (ALL)                        ');
      console.log('═══════════════════════════════════════════════════════════\n');

      if (post.lotFields) {
        console.log(JSON.stringify(post.lotFields, null, 2));
      } else {
        console.log('No lotFields found');
      }

      // Look at content/description
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('                    CONTENT/DESCRIPTION                     ');
      console.log('═══════════════════════════════════════════════════════════\n');

      if (post.content) {
        // Parse HTML and look for owner references
        const content = post.content.replace(/<[^>]+>/g, '\n').replace(/\s+/g, ' ');
        console.log(content.slice(0, 2000));

        // Search for collection/owner patterns
        const patterns = [
          /from\s+(?:the\s+)?([A-Z][^.]+?(?:Collection|Estate))/gi,
          /consigned\s+by\s+([^.]+)/gi,
          /offered\s+(?:by|from)\s+([^.]+)/gi,
          /(?:owned|purchased)\s+by\s+([^.]+)/gi,
          /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+Collection/gi
        ];

        console.log('\n--- Owner/Collection Patterns Found ---');
        patterns.forEach(p => {
          const matches = content.match(p);
          if (matches) {
            console.log(`  ${p.source.slice(0, 30)}: ${matches.join(', ')}`);
          }
        });
      }

      // Check all taxonomies
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('                    ALL TAXONOMIES                          ');
      console.log('═══════════════════════════════════════════════════════════\n');

      const taxonomyFields = Object.keys(post).filter(k =>
        k.includes('Tax') || k.includes('Categories') || k.includes('Tags')
      );

      taxonomyFields.forEach(field => {
        const data = post[field];
        if (data?.edges?.length > 0) {
          console.log(`\n${field}:`);
          data.edges.forEach(e => {
            console.log(`  - ${JSON.stringify(e.node)}`);
          });
        }
      });
    }
  }

  // 2. Check Apollo Cache State
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    APOLLO CACHE STATE                      ');
  console.log('═══════════════════════════════════════════════════════════\n');

  const apolloState = nextData?.props?.pageProps?.__APOLLO_STATE__;
  if (apolloState) {
    // Look for any entity with owner/seller info
    const entities = Object.keys(apolloState).filter(k =>
      k.includes('Lot') || k.includes('Auction') || k.includes('User') ||
      k.includes('Consign') || k.includes('Seller') || k.includes('Collection')
    );

    console.log(`Found ${entities.length} relevant entities in Apollo cache`);
    entities.slice(0, 10).forEach(key => {
      console.log(`\n${key}:`);
      console.log(JSON.stringify(apolloState[key], null, 2).slice(0, 500));
    });
  }

  // 3. Check API responses
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    API RESPONSES                           ');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Captured ${apiCalls.length} API calls`);
  apiCalls.forEach(call => {
    console.log(`\n📡 ${call.url}`);
    if (call.data.length < 1000) {
      console.log(call.data);
    } else {
      // Check for owner-related content
      if (call.data.toLowerCase().includes('owner') ||
          call.data.toLowerCase().includes('seller') ||
          call.data.toLowerCase().includes('consign')) {
        console.log('  ⚠️ Contains owner/seller data!');
        console.log(call.data.slice(0, 500));
      }
    }
  });

  // 4. Check all data attributes on page
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    DATA ATTRIBUTES                         ');
  console.log('═══════════════════════════════════════════════════════════\n');

  const dataAttrs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (attr.name.startsWith('data-')) {
          results.push({
            element: el.tagName,
            attr: attr.name,
            value: attr.value.slice(0, 200)
          });
        }
      });
    });
    return results.filter((v, i, a) =>
      a.findIndex(x => x.attr === v.attr && x.value === v.value) === i
    );
  });

  const interestingAttrs = dataAttrs.filter(a =>
    a.attr.includes('id') || a.attr.includes('lot') || a.attr.includes('user') ||
    a.attr.includes('seller') || a.attr.includes('owner') || a.value.length > 10
  );

  interestingAttrs.slice(0, 20).forEach(a => {
    console.log(`  ${a.attr}: ${a.value}`);
  });

  // 5. Check window objects
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    WINDOW OBJECTS                          ');
  console.log('═══════════════════════════════════════════════════════════\n');

  const windowData = await page.evaluate(() => {
    const interesting = {};
    const searchKeys = ['lot', 'auction', 'user', 'seller', 'owner', 'data', 'config', 'state'];

    for (const key of Object.keys(window)) {
      if (searchKeys.some(s => key.toLowerCase().includes(s))) {
        try {
          const val = window[key];
          if (val && typeof val === 'object') {
            interesting[key] = JSON.stringify(val).slice(0, 500);
          }
        } catch (e) {}
      }
    }

    // Also check for common data layer objects
    if (window.dataLayer) interesting.dataLayer = JSON.stringify(window.dataLayer).slice(0, 1000);
    if (window.gtmData) interesting.gtmData = JSON.stringify(window.gtmData).slice(0, 1000);
    if (window.__INITIAL_STATE__) interesting.__INITIAL_STATE__ = JSON.stringify(window.__INITIAL_STATE__).slice(0, 1000);

    return interesting;
  });

  Object.entries(windowData).forEach(([key, value]) => {
    console.log(`\n${key}:`);
    console.log(value);
  });

  // 6. Check meta tags
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    META TAGS                               ');
  console.log('═══════════════════════════════════════════════════════════\n');

  const metaTags = await page.evaluate(() => {
    return [...document.querySelectorAll('meta')].map(m => ({
      name: m.getAttribute('name') || m.getAttribute('property'),
      content: m.getAttribute('content')
    })).filter(m => m.name && m.content);
  });

  metaTags.forEach(m => {
    console.log(`  ${m.name}: ${m.content.slice(0, 100)}`);
  });

  // 7. Search page text for owner patterns
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    PAGE TEXT ANALYSIS                      ');
  console.log('═══════════════════════════════════════════════════════════\n');

  const bodyText = await page.evaluate(() => document.body.innerText);

  const ownerPatterns = [
    /(?:from|of)\s+the\s+([A-Z][^.]+?Collection)/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+Collection/gi,
    /Estate\s+of\s+([A-Z][^.]+)/gi,
    /Consigned\s+by\s+([^.\n]+)/gi,
    /Offered\s+by\s+([^.\n]+)/gi,
    /Seller[:\s]+([^.\n]+)/gi,
    /Owner[:\s]+([^.\n]+)/gi,
    /(?:Originally|Previously)\s+owned\s+by\s+([^.\n]+)/gi,
    /Purchased\s+(?:from|by)\s+([^.\n]+)/gi,
    /Title\s+(?:in|to)\s+([^.\n]+)/gi
  ];

  ownerPatterns.forEach(p => {
    const matches = bodyText.match(p);
    if (matches) {
      console.log(`${p.source.slice(0, 40)}...`);
      matches.forEach(m => console.log(`  → ${m}`));
    }
  });

  await browser.close();
  console.log('\n✅ Deep dive complete!');
  console.log('📁 Full data saved to /tmp/mecum-nextdata-full.json');
}

deepDive().catch(console.error);
