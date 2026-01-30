#!/usr/bin/env node
/**
 * Car Club Contact Extractor v2
 * Improved extraction that handles various email formats
 *
 * Usage: dotenvx run -- node scripts/contacts/extract-car-club-v2.js <club>
 */

import { chromium } from 'playwright';
import { saveContactLead } from './contact-utils.js';

const CLUBS = {
  ccca: {
    name: 'Classic Car Club of America',
    short: 'CCCA',
    url: 'https://classiccarclub.org/regional-clubs',
  },
  pca: {
    name: 'Porsche Club of America',
    short: 'PCA',
    url: 'https://www.pca.org/regions',
  },
  aaca: {
    name: 'Antique Automobile Club of America',
    short: 'AACA',
    url: 'https://www.aaca.org/about-aaca/our-regions',
  },
  fca: {
    name: 'Ferrari Club of America',
    short: 'FCA',
    url: 'https://ferrariclubofamerica.org/regions/',
  },
  ncrs: {
    name: 'National Corvette Restorers Society',
    short: 'NCRS',
    url: 'https://www.ncrs.org/chapters',
  },
  bmwcca: {
    name: 'BMW Car Club of America',
    short: 'BMWCCA',
    url: 'https://www.bmwcca.org/chapters',
  },
  mbca: {
    name: 'Mercedes-Benz Club of America',
    short: 'MBCA',
    url: 'https://www.mbca.org/sections',
  },
};

async function extractAllContacts(page, url, clubShort) {
  console.log(`[${clubShort}] Loading ${url}`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  // Scroll entire page to trigger lazy loading
  let lastHeight = 0;
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  // Extract contacts using multiple methods
  const contacts = await page.evaluate(() => {
    const results = [];
    const seenEmails = new Set();

    // Method 1: mailto links
    document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
      const email = link.href.replace('mailto:', '').split('?')[0].toLowerCase();
      if (email && !seenEmails.has(email)) {
        seenEmails.add(email);

        // Get context - parent text, nearby headings
        let context = '';
        let el = link;
        for (let i = 0; i < 5 && el; i++) {
          context = el.innerText || '';
          if (context.length > 20) break;
          el = el.parentElement;
        }

        // Look for region/role in context
        const regionMatch = context.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s*(?:Region|Chapter|Section)/i);
        const roleMatch = context.match(/(President|Director|Chair|Secretary|Treasurer|VP|Vice|Membership|Editor)/i);

        results.push({
          email,
          region: regionMatch ? regionMatch[1] : null,
          role: roleMatch ? roleMatch[1] : 'Contact',
          context: context.substring(0, 200)
        });
      }
    });

    // Method 2: Plaintext emails
    const text = document.body.innerText;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    let match;
    while ((match = emailRegex.exec(text)) !== null) {
      const email = match[0].toLowerCase();
      if (!seenEmails.has(email) && !email.includes('example.com') && !email.includes('domain.com')) {
        seenEmails.add(email);

        // Get surrounding context
        const idx = match.index;
        const before = text.substring(Math.max(0, idx - 150), idx);
        const after = text.substring(idx, Math.min(text.length, idx + 50));
        const context = before + after;

        const regionMatch = context.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*(?:Region|Chapter|Section|Club)/i);
        const roleMatch = context.match(/(President|Director|Chair|Secretary|Treasurer|VP|Vice|Membership|Editor|Webmaster)/i);

        results.push({
          email,
          region: regionMatch ? regionMatch[1] : null,
          role: roleMatch ? roleMatch[1] : 'Contact',
          context: context.substring(0, 200)
        });
      }
    }

    // Method 3: Look for structured region/chapter blocks
    const blocks = document.querySelectorAll('[class*="region"], [class*="chapter"], [class*="section"], [class*="club"], article, .card, .item');
    blocks.forEach(block => {
      const blockText = block.innerText;
      const blockEmails = blockText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];

      blockEmails.forEach(email => {
        email = email.toLowerCase();
        if (!seenEmails.has(email)) {
          seenEmails.add(email);

          const heading = block.querySelector('h1, h2, h3, h4, h5, strong, b');
          const regionName = heading ? heading.innerText : null;

          results.push({
            email,
            region: regionName,
            role: 'Contact',
            context: blockText.substring(0, 200)
          });
        }
      });
    });

    return results;
  });

  return contacts;
}

async function main() {
  const clubKey = process.argv[2]?.toLowerCase();

  if (!clubKey || !CLUBS[clubKey]) {
    console.log('Available clubs:');
    Object.entries(CLUBS).forEach(([key, info]) => {
      console.log(`  ${key.padEnd(8)} - ${info.name}`);
    });
    console.log('\nUsage: dotenvx run -- node scripts/contacts/extract-car-club-v2.js <club>');
    process.exit(1);
  }

  const club = CLUBS[clubKey];

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  ${club.name.toUpperCase().padEnd(58)}║`);
  console.log(`║  ${club.url.padEnd(58)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let saved = 0, errors = 0;

  try {
    const contacts = await extractAllContacts(page, club.url, club.short);
    console.log(`[${club.short}] Found ${contacts.length} contacts\n`);

    for (const contact of contacts) {
      // Skip generic/admin emails
      if (contact.email.includes('noreply') ||
          contact.email.includes('webmaster@') ||
          contact.email.includes('admin@') ||
          contact.email.includes('info@')) continue;

      const ok = await saveContactLead({
        email: contact.email,
        role: contact.role,
        region: contact.region || 'Unknown',
        organization: club.short,
        sourceUrl: club.url,
        extraData: { context: contact.context }
      });

      if (ok) {
        saved++;
        if (saved <= 5 || saved % 10 === 0) {
          console.log(`  ✓ ${contact.email} (${contact.region || 'Unknown'} ${contact.role})`);
        }
      } else {
        errors++;
      }
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(`[${club.short}] COMPLETE`);
    console.log(`  Found: ${contacts.length}`);
    console.log(`  Saved: ${saved}`);
    console.log(`  Errors/Skipped: ${errors}`);
    console.log(`════════════════════════════════════════`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
