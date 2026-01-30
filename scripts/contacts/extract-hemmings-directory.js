#!/usr/bin/env node
/**
 * Hemmings Business Directory Extractor
 * Extracts restoration shops, dealers, parts suppliers
 *
 * Usage: dotenvx run -- node scripts/contacts/extract-hemmings-directory.js [category]
 *
 * Categories: restoration, dealers, parts, all
 */

import { chromium } from 'playwright';
import { saveContactLead } from './contact-utils.js';

const BASE_URL = 'https://www.hemmings.com/business-directory';
const ORGANIZATION = 'Hemmings Directory';

const CATEGORIES = {
  restoration: '/restoration-services',
  dealers: '/dealers',
  parts: '/parts-services',
  appraisers: '/appraisers',
  transport: '/transport',
  insurance: '/insurance',
};

async function extractCategoryPage(page, categoryUrl, category) {
  const contacts = [];

  try {
    await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Scroll to load lazy content
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(300);
    }

    // Extract business listings
    const businesses = await page.evaluate(() => {
      const results = [];

      // Look for business cards/listings
      const cards = document.querySelectorAll('[class*="business"], [class*="listing"], [class*="card"], article');

      cards.forEach(card => {
        const text = card.innerText;
        const html = card.innerHTML;

        // Business name (usually in heading)
        const nameEl = card.querySelector('h2, h3, h4, [class*="name"], [class*="title"]');
        const name = nameEl ? nameEl.innerText.trim() : null;

        // Email
        const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const email = emailMatch ? emailMatch[0] : null;

        // Phone
        const phoneMatch = text.match(/(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/);
        const phone = phoneMatch ? phoneMatch[0] : null;

        // Website
        const linkEl = card.querySelector('a[href*="http"]:not([href*="hemmings"])');
        const website = linkEl ? linkEl.href : null;

        // Location
        const locationMatch = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\s*(\d{5})?/);
        const city = locationMatch ? locationMatch[1] : null;
        const state = locationMatch ? locationMatch[2] : null;

        // Detail page link
        const detailLink = card.querySelector('a[href*="/business-directory/"]');
        const detailUrl = detailLink ? detailLink.href : null;

        if (name && (email || phone || website)) {
          results.push({ name, email, phone, website, city, state, detailUrl });
        }
      });

      // Also grab any pagination links
      const nextPage = document.querySelector('a[rel="next"], [class*="pagination"] a:last-child');
      const nextUrl = nextPage ? nextPage.href : null;

      return { businesses: results, nextUrl };
    });

    contacts.push(...businesses.businesses.map(b => ({
      ...b,
      category,
      region: b.state ? `${b.city}, ${b.state}` : null
    })));

    return { contacts, nextUrl: businesses.nextUrl };

  } catch (e) {
    console.error(`Error on ${categoryUrl}:`, e.message);
    return { contacts: [], nextUrl: null };
  }
}

async function extractBusinessDetail(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    return await page.evaluate(() => {
      const text = document.body.innerText;

      const email = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0];
      const phone = text.match(/(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/)?.[0];

      // Owner/contact name
      const ownerMatch = text.match(/(?:Owner|Contact|Manager)[:\s]*([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
      const contactName = ownerMatch ? ownerMatch[1] : null;

      // Specialties
      const specialties = [];
      const specPatterns = ['restoration', 'parts', 'sales', 'appraisal', 'transport', 'paint', 'upholstery', 'mechanical'];
      specPatterns.forEach(s => {
        if (text.toLowerCase().includes(s)) specialties.push(s);
      });

      return { email, phone, contactName, specialties };
    });
  } catch (e) {
    return null;
  }
}

async function main() {
  const categoryArg = process.argv[2] || 'all';

  let categoriesToProcess = [];
  if (categoryArg === 'all') {
    categoriesToProcess = Object.entries(CATEGORIES);
  } else if (CATEGORIES[categoryArg]) {
    categoriesToProcess = [[categoryArg, CATEGORIES[categoryArg]]];
  } else {
    console.log('Available categories: restoration, dealers, parts, appraisers, transport, insurance, all');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  HEMMINGS BUSINESS DIRECTORY EXTRACTION                      ║');
  console.log(`║  Categories: ${categoryArg.padEnd(47)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let totalSaved = 0;
  let totalErrors = 0;

  try {
    for (const [catName, catPath] of categoriesToProcess) {
      console.log(`\n[Hemmings] Processing category: ${catName}`);

      let pageUrl = BASE_URL + catPath;
      let pageNum = 1;
      const maxPages = 10; // Limit pages per category

      while (pageUrl && pageNum <= maxPages) {
        console.log(`  Page ${pageNum}...`);

        const { contacts, nextUrl } = await extractCategoryPage(page, pageUrl, catName);

        for (const contact of contacts) {
          // If we have a detail URL but no email, try to get it
          if (contact.detailUrl && !contact.email) {
            const details = await extractBusinessDetail(page, contact.detailUrl);
            if (details) {
              contact.email = contact.email || details.email;
              contact.phone = contact.phone || details.phone;
              contact.contactName = details.contactName;
              contact.specialties = details.specialties;
            }
            await page.waitForTimeout(800);
          }

          const ok = await saveContactLead({
            name: contact.contactName,
            email: contact.email,
            phone: contact.phone,
            role: catName.charAt(0).toUpperCase() + catName.slice(1),
            region: contact.region,
            organization: ORGANIZATION,
            sourceUrl: contact.detailUrl || pageUrl,
            extraData: {
              business_name: contact.name,
              website: contact.website,
              specialties: contact.specialties,
              category: catName
            }
          });

          if (ok) totalSaved++;
          else totalErrors++;
        }

        pageUrl = nextUrl;
        pageNum++;
        await page.waitForTimeout(1500);
      }
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(`[Hemmings] COMPLETE`);
    console.log(`  Contacts saved: ${totalSaved}`);
    console.log(`  Errors: ${totalErrors}`);
    console.log(`════════════════════════════════════════`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
