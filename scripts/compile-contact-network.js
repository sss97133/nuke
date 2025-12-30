#!/usr/bin/env node
/**
 * Compile Contact Network from Auction Platforms
 * Extracts and links contact information across different auction houses and platforms
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Network structure:
 * - People (nodes): name, emails, phones, titles
 * - Organizations (nodes): name, website, type
 * - Relationships (edges): person -> organization (role, dates, sources)
 * - Connections: person <-> person (shared organizations, projects)
 */

class ContactNetwork {
  constructor() {
    this.people = new Map(); // email -> person data
    this.organizations = new Map(); // name/domain -> org data
    this.relationships = []; // person -> organization relationships
    this._emailIndex = null;
    this._phoneIndex = null;
    this._nameIndex = null;
  }

  /**
   * Normalize phone number for matching
   */
  normalizePhone(phone) {
    if (!phone) return null;
    return phone.replace(/[\s\-\(\)\+]/g, '').replace(/^00/, '');
  }

  /**
   * Normalize name for matching (remove extra spaces, lowercase)
   */
  normalizeName(name) {
    if (!name) return null;
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Extract domain from email for organization matching
   */
  getEmailDomain(email) {
    if (!email) return null;
    const parts = email.toLowerCase().split('@');
    return parts.length === 2 ? parts[1] : null;
  }

  /**
   * Find existing person by name, email, or phone with fuzzy matching
   */
  findExistingPerson(name, email, phone) {
    const normalizedEmail = email?.toLowerCase();
    const normalizedPhone = this.normalizePhone(phone);
    const normalizedName = this.normalizeName(name);
    
    // Build indexes on first search
    if (!this._emailIndex) {
      this._emailIndex = new Map();
      this._phoneIndex = new Map();
      this._nameIndex = new Map();
      
      for (const [key, person] of this.people.entries()) {
        // Index by email
        for (const e of person.emails) {
          this._emailIndex.set(e, key);
        }
        // Index by phone
        for (const p of person.phones) {
          const normalized = this.normalizePhone(p);
          if (normalized) {
            this._phoneIndex.set(normalized, key);
          }
        }
        // Index by name
        if (person.name) {
          const normalized = this.normalizeName(person.name);
          if (normalized) {
            if (!this._nameIndex.has(normalized)) {
              this._nameIndex.set(normalized, []);
            }
            this._nameIndex.get(normalized).push(key);
          }
        }
      }
    }
    
    // Try exact email match first (most reliable)
    if (normalizedEmail && this._emailIndex.has(normalizedEmail)) {
      return this._emailIndex.get(normalizedEmail);
    }
    
    // Try phone match
    if (normalizedPhone && this._phoneIndex.has(normalizedPhone)) {
      return this._phoneIndex.get(normalizedPhone);
    }
    
    // Try name match (may have multiple matches)
    if (normalizedName && this._nameIndex.has(normalizedName)) {
      const matches = this._nameIndex.get(normalizedName);
      // If only one match, use it
      if (matches.length === 1) {
        return matches[0];
      }
      // If multiple matches, check if any share email domain or have matching phone
      for (const matchKey of matches) {
        const person = this.people.get(matchKey);
        // If email domains match, likely same person
        if (normalizedEmail) {
          const domain = this.getEmailDomain(normalizedEmail);
          if (person.emails.some(e => this.getEmailDomain(e) === domain)) {
            return matchKey;
          }
        }
      }
      // Return first match if we can't determine
      return matches[0];
    }
    
    return null;
  }

  /**
   * Clear indexes (call after adding many people to rebuild)
   */
  clearIndexes() {
    this._emailIndex = null;
    this._phoneIndex = null;
    this._nameIndex = null;
  }

  /**
   * Add a person to the network
   */
  addPerson(data) {
    const { name, email, phone, title, organization, source, sourceUrl } = data;
    
    // Try to find existing person
    let key = this.findExistingPerson(name, email, phone);
    
    // Create new person if not found
    if (!key) {
      // Use email as primary key, fall back to name+phone if no email
      key = email?.toLowerCase() || `${name?.toLowerCase().trim()}_${phone || 'unknown'}`;
      
      if (!this.people.has(key)) {
        this.people.set(key, {
          name,
          emails: email ? [email.toLowerCase()] : [],
          phones: phone ? [phone] : [],
          titles: [],
          organizations: [],
          sources: [],
          metadata: {},
        });
      }
    }
    
    const person = this.people.get(key);
    
    // Merge data
    if (name && name.trim() && (!person.name || person.name === 'Unknown')) {
      person.name = name.trim();
    }
    if (email && !person.emails.includes(email.toLowerCase())) {
      person.emails.push(email.toLowerCase());
    }
    if (phone && !person.phones.includes(phone)) {
      person.phones.push(phone);
    }
    if (title && !person.titles.includes(title)) {
      person.titles.push(title);
    }
    if (source && !person.sources.includes(source)) {
      person.sources.push(source);
    }
    
    // Add organization relationship
    if (organization) {
      const orgKey = this.addOrganization(organization, source, sourceUrl);
      if (!person.organizations.includes(orgKey)) {
        person.organizations.push(orgKey);
      }
      
      this.relationships.push({
        person: key,
        organization: orgKey,
        role: title,
        source,
        sourceUrl,
        discoveredAt: new Date().toISOString(),
      });
    }
    
    // Clear indexes so they're rebuilt on next search (includes newly added person)
    this.clearIndexes();
  }

  /**
   * Add an organization to the network
   */
  addOrganization(name, source, sourceUrl) {
    const key = name.toLowerCase().trim();
    
    if (!this.organizations.has(key)) {
      this.organizations.set(key, {
        name,
        sources: [],
        metadata: {},
      });
    }
    
    const org = this.organizations.get(key);
    if (source && !org.sources.includes(source)) {
      org.sources.push(source);
    }
    
    return key;
  }

  /**
   * Find people by various identifiers
   */
  findPerson(identifier) {
    const lower = identifier.toLowerCase();
    
    for (const [key, person] of this.people.entries()) {
      if (person.emails.some(e => e.includes(lower))) return { key, person };
      if (person.phones.some(p => p.includes(lower))) return { key, person };
      if (person.name?.toLowerCase().includes(lower)) return { key, person };
    }
    
    return null;
  }

  /**
   * Export network as JSON
   */
  toJSON() {
    return {
      people: Array.from(this.people.entries()).map(([key, data]) => ({
        id: key,
        ...data,
      })),
      organizations: Array.from(this.organizations.entries()).map(([key, data]) => ({
        id: key,
        ...data,
      })),
      relationships: this.relationships,
      stats: {
        totalPeople: this.people.size,
        totalOrganizations: this.organizations.size,
        totalRelationships: this.relationships.length,
      },
    };
  }

  /**
   * Export people as CSV
   */
  toCSV() {
    const rows = [];
    rows.push(['Name', 'Emails', 'Phones', 'Titles', 'Organizations', 'Sources', 'Cross-Platform'].join(','));
    
    for (const [key, person] of this.people.entries()) {
      const crossPlatform = person.organizations.length > 1 ? 'Yes' : 'No';
      const row = [
        `"${(person.name || 'Unknown').replace(/"/g, '""')}"`,
        `"${person.emails.join('; ').replace(/"/g, '""')}"`,
        `"${person.phones.join('; ').replace(/"/g, '""')}"`,
        `"${person.titles.join('; ').replace(/"/g, '""')}"`,
        `"${person.organizations.map(o => this.organizations.get(o)?.name).filter(Boolean).join('; ').replace(/"/g, '""')}"`,
        `"${person.sources.join('; ').replace(/"/g, '""')}"`,
        crossPlatform,
      ];
      rows.push(row.join(','));
    }
    
    return rows.join('\n');
  }

  /**
   * Get network statistics
   */
  getStats() {
    const peopleWithEmail = Array.from(this.people.values()).filter(p => p.emails.length > 0).length;
    const peopleWithPhone = Array.from(this.people.values()).filter(p => p.phones.length > 0).length;
    const crossPlatform = Array.from(this.people.values()).filter(p => p.organizations.length > 1).length;
    
    // Top organizations by contributor count
    const orgCounts = new Map();
    for (const person of this.people.values()) {
      for (const orgKey of person.organizations) {
        orgCounts.set(orgKey, (orgCounts.get(orgKey) || 0) + 1);
      }
    }
    const topOrgs = Array.from(orgCounts.entries())
      .map(([key, count]) => ({ org: this.organizations.get(key)?.name || key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return {
      totalPeople: this.people.size,
      totalOrganizations: this.organizations.size,
      totalRelationships: this.relationships.length,
      peopleWithEmail,
      peopleWithPhone,
      peopleWithBoth: Array.from(this.people.values()).filter(p => p.emails.length > 0 && p.phones.length > 0).length,
      crossPlatform,
      topOrganizations: topOrgs,
    };
  }

  /**
   * Print network summary
   */
  printSummary() {
    console.log('\n📊 Contact Network Summary');
    console.log('='.repeat(60));
    console.log(`👥 People: ${this.people.size}`);
    console.log(`🏢 Organizations: ${this.organizations.size}`);
    console.log(`🔗 Relationships: ${this.relationships.length}`);
    
    console.log('\n👥 People:');
    // Sort by name for better readability
    const sortedPeople = Array.from(this.people.entries()).sort((a, b) => {
      const nameA = a[1].name || 'Unknown';
      const nameB = b[1].name || 'Unknown';
      return nameA.localeCompare(nameB);
    });
    
    for (const [key, person] of sortedPeople) {
      console.log(`\n  ${person.name || 'Unknown'}`);
      if (person.emails.length > 0) console.log(`    📧 ${person.emails.join(', ')}`);
      if (person.phones.length > 0) console.log(`    📞 ${person.phones.join(', ')}`);
      if (person.titles.length > 0) console.log(`    💼 ${person.titles.join(', ')}`);
      if (person.organizations.length > 0) {
        console.log(`    🏢 Organizations: ${person.organizations.map(o => this.organizations.get(o)?.name).filter(Boolean).join(', ')}`);
      }
      if (person.sources.length > 0) console.log(`    📍 Sources: ${person.sources.join(', ')}`);
    }
    
    console.log('\n🏢 Organizations:');
    for (const [key, org] of this.organizations.entries()) {
      console.log(`  ${org.name} (${org.sources.length} sources)`);
    }
  }
}

// Known data from the URLs provided
const knownContacts = [
  {
    // From Broad Arrow: https://www.broadarrowauctions.com/vehicles/dg25_r0028/1966-rolls-royce-silver-cloud-iii-mulliner-park-ward-drophead-coupe
    name: 'Paul Gaucher',
    email: 'pgaucher@hagerty.com',
    phone: '+41 79 601 3819',
    title: 'Head of Consignments, Switzerland',
    organization: 'Broad Arrow Auctions',
    source: 'broadarrow',
    sourceUrl: 'https://www.broadarrowauctions.com/vehicles/dg25_r0028/1966-rolls-royce-silver-cloud-iii-mulliner-park-ward-drophead-coupe',
  },
  {
    // From luxurytribune.com article
    name: 'Paul Gaucher',
    email: null,
    phone: null,
    title: 'Motor Cars Europe Specialist/Head of Sale Switzerland',
    organization: 'Bonhams',
    source: 'luxurytribune',
    sourceUrl: 'https://www.luxurytribune.com/les-collectionneurs-achetent-leur-reve-denfant',
  },
  {
    // From Bonhams story (referenced but not directly extracted)
    name: 'Paul Gaucher',
    email: null,
    phone: null,
    title: 'Motor Cars Europe Specialist',
    organization: 'Bonhams',
    source: 'bonhams',
    sourceUrl: 'https://www.bonhams.com/stories/31910/meet-the-specialist-paul-gaucher/',
  },
  {
    // From Bonhams consignment page
    name: null,
    email: 'eurocars@bonhams.com',
    phone: '+33 1 42 61 10 11',
    title: null,
    organization: 'Bonhams',
    source: 'bonhams',
    sourceUrl: 'https://bonhams.shorthandstories.com/sell-your-motor-car-paris-2021/',
  },
  {
    // From luxurytribune.com article
    name: 'David R. Seyffer',
    email: null,
    phone: null,
    title: 'Museum Curator',
    organization: 'IWC Schaffhausen',
    source: 'luxurytribune',
    sourceUrl: 'https://www.luxurytribune.com/les-collectionneurs-achetent-leur-reve-denfant',
  },
  {
    // From luxurytribune.com article
    name: 'Gregory Driot',
    email: null,
    phone: null,
    title: 'Founder',
    organization: 'Automobile Club de Genève',
    source: 'luxurytribune',
    sourceUrl: 'https://www.luxurytribune.com/les-collectionneurs-achetent-leur-reve-denfant',
  },
];

async function compileNetwork() {
  console.log('🔗 Compiling Contact Network from Auction Platforms\n');
  
  const network = new ContactNetwork();
  
  // Add known contacts
  console.log('📝 Adding known contacts...');
  for (const contact of knownContacts) {
    network.addPerson(contact);
  }
  
  // Query database for contributors from Broad Arrow extractions
  console.log('\n🔍 Querying database for Broad Arrow contributors...');
  try {
    // First get the Broad Arrow organization ID
    const { data: orgData } = await supabase
      .from('businesses')
      .select('id, business_name')
      .ilike('business_name', '%Broad Arrow%')
      .limit(1)
      .single();
    
    if (orgData) {
      // Query vehicles with contributor data in batches
      const BATCH_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      let totalVehicles = 0;
      let totalContributors = 0;
      
      while (hasMore) {
        const { data: vehicles, error } = await supabase
          .from('vehicles')
          .select('id, origin_metadata, platform_url')
          .eq('origin_organization_id', orgData.id)
          .range(offset, offset + BATCH_SIZE - 1);
        
        if (error) {
          console.warn(`  ⚠️  Error querying batch (offset ${offset}): ${error.message}`);
          break;
        }
        
        if (!vehicles || vehicles.length === 0) {
          hasMore = false;
          break;
        }
        
        totalVehicles += vehicles.length;
        let batchContributors = 0;
        
        // Process batch and rebuild indexes periodically
        for (const vehicle of vehicles) {
          const contributor = vehicle.origin_metadata?.contributor;
          if (contributor && (contributor.name || contributor.email || contributor.phone)) {
            network.addPerson({
              name: contributor.name,
              email: contributor.email,
              phone: contributor.phone,
              title: contributor.title,
              organization: 'Broad Arrow Auctions',
              source: 'broadarrow_extraction',
              sourceUrl: vehicle.platform_url,
            });
            batchContributors++;
          }
        }
        
        totalContributors += batchContributors;
        
        // Clear indexes every 1000 entries to rebuild (for performance)
        if (network.people.size % 1000 === 0) {
          network.clearIndexes();
        }
        
        console.log(`  📊 Processed ${totalVehicles} vehicles, found ${totalContributors} contributors so far...`);
        
        if (vehicles.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          offset += BATCH_SIZE;
        }
      }
      
      console.log(`  ✅ Total: ${totalContributors} contributors from ${totalVehicles} Broad Arrow vehicles`);
    } else {
      console.log('  ⚠️  Broad Arrow organization not found in database');
    }
  } catch (e) {
    console.warn(`  ⚠️  Error querying database: ${e.message}`);
  }
  
  // Print summary
  network.printSummary();
  
  // Print detailed statistics
  const stats = network.getStats();
  console.log('\n📈 Network Statistics:');
  console.log('='.repeat(60));
  console.log(`Total People: ${stats.totalPeople}`);
  console.log(`Total Organizations: ${stats.totalOrganizations}`);
  console.log(`Total Relationships: ${stats.totalRelationships}`);
  console.log(`People with Email: ${stats.peopleWithEmail} (${((stats.peopleWithEmail / stats.totalPeople) * 100).toFixed(1)}%)`);
  console.log(`People with Phone: ${stats.peopleWithPhone} (${((stats.peopleWithPhone / stats.totalPeople) * 100).toFixed(1)}%)`);
  console.log(`People with Both: ${stats.peopleWithBoth} (${((stats.peopleWithBoth / stats.totalPeople) * 100).toFixed(1)}%)`);
  console.log(`Cross-Platform Connections: ${stats.crossPlatform}`);
  
  if (stats.topOrganizations.length > 0) {
    console.log('\n🏆 Top Organizations by Contributor Count:');
    stats.topOrganizations.forEach((org, idx) => {
      console.log(`  ${idx + 1}. ${org.org}: ${org.count} contributors`);
    });
  }
  
  // Identify connections (people who appear in multiple organizations)
  console.log('\n🔗 Cross-Platform Connections:');
  const connections = [];
  for (const [key, person] of network.people.entries()) {
    if (person.organizations.length > 1) {
      connections.push({
        name: person.name,
        organizations: person.organizations.map(o => network.organizations.get(o)?.name).filter(Boolean),
        emails: person.emails,
        phones: person.phones,
        titles: person.titles,
      });
    }
  }
  
  if (connections.length > 0) {
    console.log(`  Found ${connections.length} people connected to multiple organizations:\n`);
    connections.slice(0, 20).forEach((conn, idx) => {
      console.log(`  ${idx + 1}. ${conn.name || 'Unknown'}`);
      console.log(`     Organizations: ${conn.organizations.join(' → ')}`);
      if (conn.emails.length > 0) console.log(`     Email: ${conn.emails.join(', ')}`);
      if (conn.phones.length > 0) console.log(`     Phone: ${conn.phones.join(', ')}`);
      if (conn.titles.length > 0) console.log(`     Titles: ${conn.titles.join(', ')}`);
      console.log('');
    });
    if (connections.length > 20) {
      console.log(`  ... and ${connections.length - 20} more connections`);
    }
  } else {
    console.log('  No cross-platform connections found');
  }
  
  // Export to files
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputDir = path.join(__dirname, '../data/contact-network');
  
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Export JSON
    const jsonOutput = network.toJSON();
    const jsonPath = path.join(outputDir, `network-${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
    console.log(`\n💾 Exported JSON to: ${jsonPath}`);
    
    // Export CSV
    const csvOutput = network.toCSV();
    const csvPath = path.join(outputDir, `network-${timestamp}.csv`);
    fs.writeFileSync(csvPath, csvOutput);
    console.log(`💾 Exported CSV to: ${csvPath}`);
    
    // Create latest symlinks
    const latestJson = path.join(outputDir, 'network-latest.json');
    const latestCsv = path.join(outputDir, 'network-latest.csv');
    try {
      if (fs.existsSync(latestJson)) fs.unlinkSync(latestJson);
      if (fs.existsSync(latestCsv)) fs.unlinkSync(latestCsv);
      fs.copyFileSync(jsonPath, latestJson);
      fs.copyFileSync(csvPath, latestCsv);
      console.log(`🔗 Created latest symlinks: network-latest.json, network-latest.csv`);
    } catch (e) {
      // Symlinks might not work on all systems, just copy instead
      console.log(`ℹ️  Latest files updated`);
    }
  } catch (e) {
    console.warn(`⚠️  Error saving files: ${e.message}`);
  }
  
  // Return network data
  return network.toJSON();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  compileNetwork().catch(console.error);
}

export { ContactNetwork, compileNetwork };

