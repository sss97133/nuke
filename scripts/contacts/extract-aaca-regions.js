#!/usr/bin/env node
/**
 * AACA (Antique Automobile Club of America) Region Contact Extractor
 * Extracts officer contacts from 400+ regional clubs
 *
 * Usage: dotenvx run -- node scripts/contacts/extract-aaca-regions.js
 */

import { chromium } from 'playwright';
import { saveContactLead, extractEmails, extractPhones, cleanName } from './contact-utils.js';

const SOURCE_URL = 'https://www.aaca.org/regions';
const ORGANIZATION = 'AACA';

async function extractRegions(page) {
  console.log(`\n[AACA] Fetching region list from ${SOURCE_URL}`);

  await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Scroll to load lazy content
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(300);
  }

  // Extract region links and basic info
  const regions = await page.evaluate(() => {
    const results = [];

    // Look for region entries - AACA typically lists regions with links
    const links = document.querySelectorAll('a[href*="region"], a[href*="chapter"], a[href*="club"]');

    links.forEach(link => {
      const href = link.href;
      const name = link.innerText.trim();
      if (name && name.length > 3 && !href.includes('javascript')) {
        results.push({ name, url: href });
      }
    });

    // Also look for any visible contact info on main page
    const text = document.body.innerText;
    const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];

    return { regions: results, pageEmails: [...new Set(emailMatches)] };
  });

  return regions;
}

async function extractRegionDetails(page, regionUrl, regionName) {
  const contacts = [];

  try {
    await page.goto(regionUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    const data = await page.evaluate(() => {
      const text = document.body.innerText;

      // Extract all emails
      const emails = [...new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])];

      // Extract phones
      const phones = [...new Set(text.match(/(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g) || [])];

      // Look for officer titles near emails
      const officerPatterns = [
        /president[:\s]*([^\n,]+)/i,
        /vice[\s-]?president[:\s]*([^\n,]+)/i,
        /secretary[:\s]*([^\n,]+)/i,
        /treasurer[:\s]*([^\n,]+)/i,
        /director[:\s]*([^\n,]+)/i,
        /chairman?[:\s]*([^\n,]+)/i,
        /editor[:\s]*([^\n,]+)/i,
        /webmaster[:\s]*([^\n,]+)/i,
      ];

      const officers = [];
      officerPatterns.forEach(pattern => {
        const match = text.match(pattern);
        if (match) {
          officers.push({
            role: pattern.source.split('[')[0].replace(/\\/g, ''),
            name: match[1].trim().substring(0, 50)
          });
        }
      });

      return { emails, phones, officers, hasContent: text.length > 500 };
    });

    // Create contact entries for each email found
    for (const email of data.emails) {
      // Skip generic emails
      if (email.includes('noreply') || email.includes('webmaster@aaca.org')) continue;

      // Try to match email with officer role
      let role = 'Member';
      let name = null;

      for (const officer of data.officers) {
        if (officer.name.toLowerCase().includes(email.split('@')[0].toLowerCase())) {
          role = officer.role;
          name = officer.name;
          break;
        }
      }

      contacts.push({
        name,
        email,
        phone: data.phones[0] || null,
        role,
        region: regionName
      });
    }

  } catch (e) {
    // Silent fail - continue with other regions
  }

  return contacts;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  AACA CONTACT EXTRACTION                                     ║');
  console.log('║  Source: aaca.org/regions                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let totalSaved = 0;
  let totalErrors = 0;

  try {
    // Get list of regions
    const { regions, pageEmails } = await extractRegions(page);
    console.log(`[AACA] Found ${regions.length} regions, ${pageEmails.length} emails on main page`);

    // Save emails from main page
    for (const email of pageEmails) {
      if (email.includes('noreply')) continue;
      const ok = await saveContactLead({
        email,
        role: 'Contact',
        region: 'National',
        organization: ORGANIZATION,
        sourceUrl: SOURCE_URL
      });
      if (ok) totalSaved++;
    }

    // Visit each region page for detailed extraction
    const regionLimit = Math.min(regions.length, 100); // Limit for safety

    for (let i = 0; i < regionLimit; i++) {
      const region = regions[i];

      if (i % 10 === 0) {
        console.log(`[AACA] Processing region ${i + 1}/${regionLimit}...`);
      }

      const contacts = await extractRegionDetails(page, region.url, region.name);

      for (const contact of contacts) {
        const ok = await saveContactLead({
          ...contact,
          organization: ORGANIZATION,
          sourceUrl: region.url
        });
        if (ok) totalSaved++;
        else totalErrors++;
      }

      // Rate limiting
      await page.waitForTimeout(1200);
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(`[AACA] COMPLETE`);
    console.log(`  Regions processed: ${regionLimit}`);
    console.log(`  Contacts saved: ${totalSaved}`);
    console.log(`  Errors: ${totalErrors}`);
    console.log(`════════════════════════════════════════`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
