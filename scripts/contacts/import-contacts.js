#!/usr/bin/env node
/**
 * Contact Import Tool
 * Import contacts from various sources: CSV, JSON, manual lists
 *
 * Usage:
 *   dotenvx run -- node scripts/contacts/import-contacts.js <source> [file]
 *
 * Sources:
 *   - clubs      : Import hardcoded club contacts
 *   - csv        : Import from CSV file
 *   - json       : Import from JSON file
 */

import { saveContactLead } from './contact-utils.js';
import { readFileSync } from 'fs';

// Hardcoded contact lists from manual research
// These are public emails from club websites, collected manually
const CLUB_CONTACTS = {
  ccca: {
    organization: 'Classic Car Club of America',
    short: 'CCCA',
    source: 'https://classiccarclub.org/regional-clubs',
    contacts: [
      { email: 'dale@lansdale.com', region: 'Arizona', role: 'Director' },
      { email: 'akstraw@icloud.com', region: 'Carolina', role: 'Director' },
      { email: 'johnfarrall2@gmail.com', region: 'Carolina', role: 'Chair' },
      { email: 'lynnshirey@gmail.com', region: 'Chesapeake Bay', role: 'Director' },
      { email: 'b.kittleson@delicatesound.com', region: 'Colorado', role: 'Director' },
      { email: 'rjpraetorius@gmail.com', region: 'Delaware Valley', role: 'Director' },
      { email: 'dsalzman@comcast.net', region: 'Florida', role: 'Director' },
      { email: 'russarod@gmail.com', region: 'Greater Illinois', role: 'Director' },
      { email: 'aajj88@optonline.net', region: 'Long Island Sound', role: 'Director' },
      { email: 'grk129@gmail.com', region: 'Metro NY', role: 'Director' },
      { email: 'fwd9@hotmail.com', region: 'Pacific NW', role: 'Director' },
      { email: 'mikesadams4@gmail.com', region: 'San Diego', role: 'Director' },
      { email: 'jonleim@yahoo.com', region: 'Western PA', role: 'Director' },
      { email: 'jim.j.nicholson@gmail.com', region: 'Wisconsin', role: 'Director' },
      // Add more as discovered
    ]
  },

  // Template for adding more clubs
  aaca_national: {
    organization: 'Antique Automobile Club of America',
    short: 'AACA',
    source: 'https://www.aaca.org/about-aaca/national-officers',
    contacts: [
      // National officers from public website
      { email: 'president@aaca.org', role: 'President', region: 'National' },
      { email: 'vp@aaca.org', role: 'Vice President', region: 'National' },
    ]
  },

  // Hemmings advertisers (these are businesses that WANT to be contacted)
  hemmings_advertisers: {
    organization: 'Hemmings Advertisers',
    short: 'HEMM',
    source: 'https://www.hemmings.com',
    contacts: [
      // Add business contacts from Hemmings ads
    ]
  },

  // Add concours judges, event organizers, etc.
};

async function importClubContacts(clubKey) {
  const club = CLUB_CONTACTS[clubKey];
  if (!club) {
    console.log('Available clubs:', Object.keys(CLUB_CONTACTS).join(', '));
    process.exit(1);
  }

  console.log(`\nImporting ${club.short} contacts...`);
  console.log(`Source: ${club.source}`);
  console.log(`Contacts: ${club.contacts.length}\n`);

  let saved = 0, skipped = 0;

  for (const contact of club.contacts) {
    const ok = await saveContactLead({
      email: contact.email,
      name: contact.name,
      role: contact.role,
      region: contact.region,
      organization: club.short,
      sourceUrl: club.source,
      extraData: { imported_from: 'hardcoded_list' }
    });

    if (ok) {
      saved++;
      console.log(`  ✓ ${contact.email} (${contact.region} ${contact.role})`);
    } else {
      skipped++;
    }
  }

  console.log(`\nComplete: ${saved} saved, ${skipped} skipped`);
}

async function importFromCSV(filepath) {
  const content = readFileSync(filepath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  console.log(`\nImporting from CSV: ${filepath}`);
  console.log(`Headers: ${headers.join(', ')}`);
  console.log(`Rows: ${lines.length - 1}\n`);

  let saved = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, idx) => row[h] = values[idx]);

    const ok = await saveContactLead({
      email: row.email,
      name: row.name,
      phone: row.phone,
      role: row.role || row.title || 'Contact',
      region: row.region || row.location || row.state,
      organization: row.organization || row.company || 'Import',
      sourceUrl: row.source || row.url || filepath,
    });

    if (ok) saved++;
  }

  console.log(`\nComplete: ${saved} saved`);
}

async function importFromJSON(filepath) {
  const content = readFileSync(filepath, 'utf-8');
  const data = JSON.parse(content);
  const contacts = Array.isArray(data) ? data : data.contacts;

  console.log(`\nImporting from JSON: ${filepath}`);
  console.log(`Contacts: ${contacts.length}\n`);

  let saved = 0;

  for (const contact of contacts) {
    const ok = await saveContactLead({
      email: contact.email,
      name: contact.name,
      phone: contact.phone,
      role: contact.role || 'Contact',
      region: contact.region,
      organization: contact.organization || 'Import',
      sourceUrl: contact.source || filepath,
    });

    if (ok) saved++;
  }

  console.log(`\nComplete: ${saved} saved`);
}

async function main() {
  const source = process.argv[2];
  const arg = process.argv[3];

  if (!source) {
    console.log('Contact Import Tool\n');
    console.log('Usage:');
    console.log('  dotenvx run -- node scripts/contacts/import-contacts.js clubs <club-key>');
    console.log('  dotenvx run -- node scripts/contacts/import-contacts.js csv <filepath>');
    console.log('  dotenvx run -- node scripts/contacts/import-contacts.js json <filepath>');
    console.log('\nAvailable clubs:', Object.keys(CLUB_CONTACTS).join(', '));
    process.exit(1);
  }

  switch (source) {
    case 'clubs':
      if (arg === 'all') {
        for (const key of Object.keys(CLUB_CONTACTS)) {
          await importClubContacts(key);
        }
      } else {
        await importClubContacts(arg || Object.keys(CLUB_CONTACTS)[0]);
      }
      break;

    case 'csv':
      if (!arg) {
        console.log('Please provide CSV filepath');
        process.exit(1);
      }
      await importFromCSV(arg);
      break;

    case 'json':
      if (!arg) {
        console.log('Please provide JSON filepath');
        process.exit(1);
      }
      await importFromJSON(arg);
      break;

    default:
      console.log('Unknown source:', source);
      process.exit(1);
  }
}

main().catch(console.error);
