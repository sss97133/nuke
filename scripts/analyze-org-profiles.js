#!/usr/bin/env node

/**
 * Organization Profile Health Analysis
 * 
 * Analyzes organization profiles to identify:
 * - Data completeness (missing fields)
 * - Data quality issues
 * - Bad/malformed data
 * - Profile statistics
 * - What makes good vs bad profiles
 */

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Field categories
const CRITICAL_FIELDS = [
  'business_name',
  'business_type',
  'website',
];

const IMPORTANT_FIELDS = [
  'phone',
  'email',
  'address',
  'city',
  'state',
  'description',
  'logo_url',
];

const NICE_TO_HAVE_FIELDS = [
  'legal_name',
  'latitude',
  'longitude',
  'zip_code',
  'banner_url',
  'services_offered',
  'specializations',
  'years_in_business',
];

function isBadImageUrl(url) {
  if (!url) return false;
  const s = String(url || '').toLowerCase();
  // Filter out magazine/news publication logos
  const badPatterns = [
    'vanityfair', 'vanity-fair', 'vanity_fair',
    'time.com', 'forbes.com', 'wsj.com', 'wallstreetjournal',
    'nytimes.com', 'nytimes', 'theatlantic.com', 'theatlantic',
    'newyorker.com', 'newyorker',
    'google.com/s2/favicons', '/s2/favicons', 'favicon', '.ico'
  ];
  return badPatterns.some(pattern => s.includes(pattern));
}

function isValidWebsite(url) {
  if (!url) return false;
  const urlStr = String(url).trim();
  return /^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(urlStr);
}

function isValidEmail(email) {
  if (!email) return false;
  const emailStr = String(email).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr);
}

function isValidPhone(phone) {
  if (!phone) return false;
  const phoneStr = String(phone).replace(/\D/g, '');
  return phoneStr.length >= 10;
}

async function analyzeProfile(org) {
  const issues = [];
  const strengths = [];
  let completenessScore = 0;
  let maxScore = 0;

  // Critical fields (required)
  maxScore += CRITICAL_FIELDS.length * 10;
  for (const field of CRITICAL_FIELDS) {
    if (org[field]) {
      completenessScore += 10;
      if (field === 'website' && !isValidWebsite(org[field])) {
        issues.push(`Invalid website format: ${org[field]}`);
      }
    } else {
      issues.push(`Missing critical field: ${field}`);
    }
  }

  // Important fields
  maxScore += IMPORTANT_FIELDS.length * 5;
  for (const field of IMPORTANT_FIELDS) {
    if (org[field]) {
      completenessScore += 5;
      
      // Validate specific fields
      if (field === 'email' && !isValidEmail(org[field])) {
        issues.push(`Invalid email format: ${org[field]}`);
      }
      if (field === 'phone' && !isValidPhone(org[field])) {
        issues.push(`Invalid phone format: ${org[field]}`);
      }
      if (field === 'logo_url' && isBadImageUrl(org[field])) {
        issues.push(`Bad logo URL (magazine/publication): ${org[field]}`);
      }
    } else {
      issues.push(`Missing important field: ${field}`);
    }
  }

  // Nice to have fields
  maxScore += NICE_TO_HAVE_FIELDS.length * 2;
  for (const field of NICE_TO_HAVE_FIELDS) {
    if (org[field]) {
      completenessScore += 2;
    }
  }

  // Check for bad data
  if (org.logo_url && isBadImageUrl(org.logo_url)) {
    issues.push(`Bad logo URL detected: ${org.logo_url}`);
  }

  // Check relationships
  const [vehicleCount, imageCount, contributorCount] = await Promise.all([
    supabase.from('organization_vehicles').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
    supabase.from('organization_images').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
    supabase.from('organization_contributors').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
  ]);

  const vehicles = vehicleCount.count || 0;
  const images = imageCount.count || 0;
  const contributors = contributorCount.count || 0;

  // Strengths
  if (org.description && org.description.length > 50) strengths.push('Has detailed description');
  if (org.logo_url && !isBadImageUrl(org.logo_url)) strengths.push('Has valid logo');
  if (org.latitude && org.longitude) strengths.push('Has geocoded location');
  if (vehicles > 0) strengths.push(`Has ${vehicles} vehicle(s) linked`);
  if (images > 0) strengths.push(`Has ${images} image(s)`);
  if (contributors > 0) strengths.push(`Has ${contributors} contributor(s)`);
  if (org.is_verified) strengths.push('Verified organization');
  if (org.services_offered && org.services_offered.length > 0) strengths.push(`Offers ${org.services_offered.length} service(s)`);

  const completenessPercent = maxScore > 0 ? Math.round((completenessScore / maxScore) * 100) : 0;

  return {
    id: org.id,
    name: org.business_name,
    completeness: completenessPercent,
    issues,
    strengths,
    vehicles,
    images,
    contributors,
    hasLocation: !!(org.latitude && org.longitude),
    isVerified: org.is_verified || false,
    isPublic: org.is_public || false,
  };
}

async function main() {
  console.log('🔍 Analyzing organization profiles...\n');

  // Load all organizations
  const { data: orgs, error } = await supabase
    .from('businesses')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error loading organizations:', error);
    process.exit(1);
  }

  if (!orgs || orgs.length === 0) {
    console.log('ℹ️  No organizations found');
    return;
  }

  console.log(`📊 Found ${orgs.length} organization(s)\n`);
  console.log('Analyzing each profile...\n');

  // Analyze each profile
  const analyses = [];
  for (const org of orgs) {
    const analysis = await analyzeProfile(org);
    analyses.push(analysis);
  }

  // Sort by completeness (worst first)
  analyses.sort((a, b) => a.completeness - b.completeness);

  // Summary statistics
  const avgCompleteness = Math.round(analyses.reduce((sum, a) => sum + a.completeness, 0) / analyses.length);
  const profilesWithIssues = analyses.filter(a => a.issues.length > 0).length;
  const profilesWithNoVehicles = analyses.filter(a => a.vehicles === 0).length;
  const profilesWithNoImages = analyses.filter(a => a.images === 0).length;
  const profilesWithBadLogos = analyses.filter(a => a.issues.some(i => i.includes('Bad logo URL'))).length;
  const verifiedCount = analyses.filter(a => a.isVerified).length;
  const publicCount = analyses.filter(a => a.isPublic).length;

  // Print summary
  console.log('='.repeat(80));
  console.log('📊 ORGANIZATION PROFILE HEALTH SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nTotal Organizations: ${orgs.length}`);
  console.log(`Average Completeness: ${avgCompleteness}%`);
  console.log(`Verified: ${verifiedCount} (${Math.round(verifiedCount/orgs.length*100)}%)`);
  console.log(`Public: ${publicCount} (${Math.round(publicCount/orgs.length*100)}%)`);
  console.log(`\nIssues Found:`);
  console.log(`  - Profiles with issues: ${profilesWithIssues} (${Math.round(profilesWithIssues/orgs.length*100)}%)`);
  console.log(`  - Bad logo URLs: ${profilesWithBadLogos}`);
  console.log(`  - No vehicles linked: ${profilesWithNoVehicles} (${Math.round(profilesWithNoVehicles/orgs.length*100)}%)`);
  console.log(`  - No images: ${profilesWithNoImages} (${Math.round(profilesWithNoImages/orgs.length*100)}%)`);

  // Top issues
  const allIssues = analyses.flatMap(a => a.issues);
  const issueCounts = {};
  allIssues.forEach(issue => {
    const key = issue.split(':')[0]; // Get issue type
    issueCounts[key] = (issueCounts[key] || 0) + 1;
  });

  console.log(`\n📋 Most Common Issues:`);
  Object.entries(issueCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([issue, count]) => {
      console.log(`  - ${issue}: ${count} occurrences`);
    });

  // Worst profiles
  console.log(`\n⚠️  WORST PROFILES (Bottom 10 by Completeness):`);
  console.log('-'.repeat(80));
  analyses.slice(0, 10).forEach((a, i) => {
    console.log(`\n${i + 1}. ${a.name} (ID: ${a.id})`);
    console.log(`   Completeness: ${a.completeness}%`);
    console.log(`   Issues: ${a.issues.length}`);
    if (a.issues.length > 0) {
      a.issues.slice(0, 5).forEach(issue => console.log(`     - ${issue}`));
      if (a.issues.length > 5) console.log(`     ... and ${a.issues.length - 5} more`);
    }
    if (a.strengths.length > 0) {
      console.log(`   Strengths: ${a.strengths.join(', ')}`);
    }
  });

  // Best profiles
  console.log(`\n✅ BEST PROFILES (Top 10 by Completeness):`);
  console.log('-'.repeat(80));
  analyses.slice(-10).reverse().forEach((a, i) => {
    console.log(`\n${i + 1}. ${a.name} (ID: ${a.id})`);
    console.log(`   Completeness: ${a.completeness}%`);
    if (a.strengths.length > 0) {
      console.log(`   Strengths: ${a.strengths.join(', ')}`);
    }
    if (a.issues.length > 0) {
      console.log(`   Issues: ${a.issues.join(', ')}`);
    }
  });

  // Recommendations
  console.log(`\n💡 RECOMMENDATIONS:`);
  console.log('-'.repeat(80));
  if (profilesWithBadLogos > 0) {
    console.log(`\n1. Fix bad logo URLs: ${profilesWithBadLogos} profiles have magazine/publication logos`);
    console.log(`   Run: node scripts/remove-magazine-org-images.js`);
  }
  if (profilesWithNoVehicles > orgs.length * 0.3) {
    console.log(`\n2. Link vehicles: ${profilesWithNoVehicles} profiles (${Math.round(profilesWithNoVehicles/orgs.length*100)}%) have no vehicles`);
  }
  if (profilesWithNoImages > orgs.length * 0.3) {
    console.log(`\n3. Add images: ${profilesWithNoImages} profiles (${Math.round(profilesWithNoImages/orgs.length*100)}%) have no images`);
  }
  if (avgCompleteness < 70) {
    console.log(`\n4. Improve completeness: Average is only ${avgCompleteness}%`);
    console.log(`   Focus on: ${IMPORTANT_FIELDS.filter(f => issueCounts[`Missing important field: ${f}`] > orgs.length * 0.3).join(', ')}`);
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
