#!/usr/bin/env node
/**
 * Generic Car Club Contact Extractor
 * Configurable extractor for any car club with region/chapter pages
 *
 * Usage: dotenvx run -- node scripts/contacts/extract-car-club.js <config-name>
 *
 * Configs defined below for each club
 */

import { chromium } from 'playwright';
import { saveContactLead } from './contact-utils.js';

// Club configurations
const CLUB_CONFIGS = {
  pca: {
    name: 'Porsche Club of America',
    shortName: 'PCA',
    regionsUrl: 'https://www.pca.org/regions',
    regionLinkPattern: '/region/',
    officerTitles: ['president', 'vice president', 'secretary', 'treasurer', 'membership', 'webmaster'],
  },
  vmcca: {
    name: 'Vintage Motor Car Club of America',
    shortName: 'VMCCA',
    regionsUrl: 'https://www.vmcca.org/chapters',
    regionLinkPattern: '/chapter',
    officerTitles: ['president', 'vice president', 'secretary', 'treasurer', 'director'],
  },
  hcca: {
    name: 'Horseless Carriage Club of America',
    shortName: 'HCCA',
    regionsUrl: 'https://www.hcca.org/sections',
    regionLinkPattern: '/section',
    officerTitles: ['president', 'secretary', 'treasurer', 'director'],
  },
  nccc: {
    name: 'National Council of Corvette Clubs',
    shortName: 'NCCC',
    regionsUrl: 'https://www.corvettesnccc.org/ClubsFindAClub.html',
    regionLinkPattern: 'club',
    officerTitles: ['president', 'governor', 'secretary', 'treasurer'],
  },
  mca: {
    name: 'Mustang Club of America',
    shortName: 'MCA',
    regionsUrl: 'https://www.mustang.org/regional-clubs/',
    regionLinkPattern: '/regional',
    officerTitles: ['president', 'vice president', 'secretary', 'treasurer'],
  },
  fca: {
    name: 'Ferrari Club of America',
    shortName: 'FCA',
    regionsUrl: 'https://ferrariclubofamerica.org/regions/',
    regionLinkPattern: '/region',
    officerTitles: ['president', 'vice president', 'secretary', 'treasurer', 'director'],
  },
  mafca: {
    name: 'Model A Ford Club of America',
    shortName: 'MAFCA',
    regionsUrl: 'https://www.mafca.com/chapters.html',
    regionLinkPattern: 'chapter',
    officerTitles: ['president', 'vice president', 'secretary', 'treasurer', 'editor'],
  },
  acd: {
    name: 'Auburn Cord Duesenberg Club',
    shortName: 'ACD',
    regionsUrl: 'https://www.acdclub.org/regions/',
    regionLinkPattern: '/region',
    officerTitles: ['president', 'vice president', 'secretary', 'treasurer', 'director'],
  },
  packard: {
    name: 'Packard Club',
    shortName: 'PAC',
    regionsUrl: 'https://www.packardclub.org/regions',
    regionLinkPattern: '/region',
    officerTitles: ['president', 'vice president', 'secretary', 'treasurer'],
  },
  ccca: {
    name: 'Classic Car Club of America',
    shortName: 'CCCA',
    regionsUrl: 'https://classiccarclub.org/regional-clubs',
    regionLinkPattern: '/region',
    officerTitles: ['director', 'chair', 'president', 'vice president', 'secretary', 'treasurer'],
  }
};

async function extractContacts(page, config) {
  console.log(`\n[${config.shortName}] Fetching from ${config.regionsUrl}`);

  await page.goto(config.regionsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  // Scroll to load content
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(300);
  }

  // Extract all emails and context from the page
  const data = await page.evaluate((cfg) => {
    const text = document.body.innerText;
    const html = document.body.innerHTML;

    // Find all emails
    const emails = [...new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])];

    // Find region/chapter names (look for common patterns)
    const regionPatterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Region|Chapter|Section|Club)/g,
      /(?:Region|Chapter|Section):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
    ];

    const regions = new Set();
    regionPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1] && match[1].length > 2 && match[1].length < 50) {
          regions.add(match[1]);
        }
      }
    });

    // Try to associate emails with nearby text (officer titles, region names)
    const emailContexts = emails.map(email => {
      // Find email position and get surrounding text
      const idx = text.indexOf(email);
      const before = text.substring(Math.max(0, idx - 200), idx);
      const after = text.substring(idx, Math.min(text.length, idx + 100));
      const context = before + after;

      // Look for officer titles
      let role = null;
      cfg.officerTitles.forEach(title => {
        if (context.toLowerCase().includes(title)) {
          role = title.charAt(0).toUpperCase() + title.slice(1);
        }
      });

      // Look for region name
      let region = null;
      regions.forEach(r => {
        if (context.includes(r)) {
          region = r;
        }
      });

      // Look for name (common patterns before email)
      const nameMatch = before.match(/([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[:\-]?\s*$/);
      const name = nameMatch ? nameMatch[1] : null;

      return { email, role, region, name, context: context.substring(0, 100) };
    });

    // Also look for region detail page links
    const regionLinks = [];
    document.querySelectorAll('a').forEach(a => {
      if (a.href && a.href.includes(cfg.regionLinkPattern)) {
        regionLinks.push({ url: a.href, name: a.innerText.trim() });
      }
    });

    return { emailContexts, regionLinks, totalEmails: emails.length };
  }, config);

  return data;
}

async function extractRegionPage(page, url, regionName, config) {
  const contacts = [];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    const data = await page.evaluate((cfg) => {
      const text = document.body.innerText;
      const emails = [...new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])];
      const phones = [...new Set(text.match(/(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g) || [])];

      // Extract officer info
      const officers = [];
      cfg.officerTitles.forEach(title => {
        const pattern = new RegExp(title + '[:\\s]*([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+)', 'i');
        const match = text.match(pattern);
        if (match) {
          officers.push({ role: title, name: match[1] });
        }
      });

      return { emails, phones, officers };
    }, config);

    for (const email of data.emails) {
      if (email.includes('noreply') || email.includes('admin@') || email.includes('webmaster@')) continue;

      // Try to match with officer
      let role = 'Contact';
      let name = null;
      for (const officer of data.officers) {
        if (email.toLowerCase().includes(officer.name.split(' ')[0].toLowerCase())) {
          role = officer.role.charAt(0).toUpperCase() + officer.role.slice(1);
          name = officer.name;
          break;
        }
      }

      contacts.push({ email, role, name, region: regionName, phone: data.phones[0] });
    }
  } catch (e) {
    // Silent fail
  }

  return contacts;
}

async function main() {
  const configName = process.argv[2];

  if (!configName || !CLUB_CONFIGS[configName]) {
    console.log('Available clubs:');
    Object.entries(CLUB_CONFIGS).forEach(([key, cfg]) => {
      console.log(`  ${key.padEnd(10)} - ${cfg.name}`);
    });
    console.log('\nUsage: dotenvx run -- node scripts/contacts/extract-car-club.js <club-name>');
    process.exit(1);
  }

  const config = CLUB_CONFIGS[configName];

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  ${config.name.toUpperCase().padEnd(58)}║`);
  console.log(`║  Source: ${config.regionsUrl.substring(0, 50).padEnd(50)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let totalSaved = 0;
  let totalErrors = 0;

  try {
    const data = await extractContacts(page, config);
    console.log(`[${config.shortName}] Found ${data.totalEmails} emails, ${data.regionLinks.length} region links`);

    // Save contacts from main page
    for (const ctx of data.emailContexts) {
      if (ctx.email.includes('noreply') || ctx.email.includes('admin@')) continue;

      const ok = await saveContactLead({
        name: ctx.name,
        email: ctx.email,
        role: ctx.role || 'Contact',
        region: ctx.region || 'Unknown',
        organization: config.shortName,
        sourceUrl: config.regionsUrl
      });
      if (ok) totalSaved++;
      else totalErrors++;
    }

    // Visit region pages for more contacts
    const regionLimit = Math.min(data.regionLinks.length, 50);
    console.log(`[${config.shortName}] Processing ${regionLimit} region pages...`);

    for (let i = 0; i < regionLimit; i++) {
      const region = data.regionLinks[i];

      if (i % 10 === 0 && i > 0) {
        console.log(`[${config.shortName}] ${i}/${regionLimit} regions, ${totalSaved} saved`);
      }

      const contacts = await extractRegionPage(page, region.url, region.name, config);

      for (const contact of contacts) {
        const ok = await saveContactLead({
          ...contact,
          organization: config.shortName,
          sourceUrl: region.url
        });
        if (ok) totalSaved++;
        else totalErrors++;
      }

      await page.waitForTimeout(1200);
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(`[${config.shortName}] COMPLETE`);
    console.log(`  Contacts saved: ${totalSaved}`);
    console.log(`  Errors: ${totalErrors}`);
    console.log(`════════════════════════════════════════`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
