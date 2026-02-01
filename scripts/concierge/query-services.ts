#!/usr/bin/env npx tsx
/**
 * St Barth Concierge Service Query
 * Query imported businesses for AI concierge requests
 *
 * Usage:
 *   npx tsx scripts/concierge/query-services.ts "villa rental"
 *   npx tsx scripts/concierge/query-services.ts --category=tourisme
 *   npx tsx scripts/concierge/query-services.ts --service=location-d-automobiles
 */

import { createClient } from '@supabase/supabase-js';

// Map common English terms to French service slugs
const SERVICE_MAP: Record<string, string[]> = {
  // Accommodation
  'villa': ['agences-de-location-de-villas', 'management-de-villas'],
  'hotel': ['hotels', 'residences-de-tourisme-residences-hotelieres'],
  'accommodation': ['hotels', 'agences-de-location-de-villas', 'chambres-d-hotes'],

  // Transport
  'car rental': ['location-d-automobiles', 'location-d-automobiles-longue-duree'],
  'car': ['location-d-automobiles'],
  'scooter': ['location-de-motos-et-cycles'],
  'bike': ['location-de-motos-et-cycles'],
  'taxi': ['taxis', 'transports-passagers-routiers'],
  'boat': ['location-de-bateaux', 'bateaux-vente-reparation-gardiennage'],
  'yacht': ['location-de-bateaux'],
  'jet ski': ['jet-ski-location'],
  'flight': ['affretement-vols-prives-assistance-passagers-et-bagages', 'compagnies-aeriennes'],

  // Water activities
  'diving': ['plongee-sous-marine'],
  'scuba': ['plongee-sous-marine'],
  'kayak': ['sports-nautiques-et-aquatiques'],
  'water sports': ['sports-nautiques-et-aquatiques'],
  'fishing': ['peche-au-gros', 'peche-a-la-mouche'],

  // Home services
  'repair': ['reparateurs', 'depannages-a-domicile'],
  'furniture': ['ebenisterie', 'menuiseries', 'meubles-ameublement'],
  'table': ['ebenisterie', 'menuiseries'],
  'woodwork': ['ebenisterie', 'menuiseries', 'charpente-en-bois'],
  'plumber': ['plombiers'],
  'electrician': ['electricite'],
  'pool': ['piscinistes-maintenance', 'piscines-accessoires-fournitures'],
  'garden': ['jardiniers', 'elagage', 'pepinieriste'],
  'cleaning': ['prestataires-service-a-domicile', 'aide-a-domicile'],
  'pest control': ['desinsectisation-desinfection-deratisation'],
  'ac': ['climatisation', 'frigoristes'],
  'air conditioning': ['climatisation'],

  // Food & Dining
  'restaurant': ['restaurants'],
  'catering': ['traiteurs'],
  'grocery': ['epiceries', 'supermarches'],
  'bakery': ['boulangeries-patisseries'],
  'wine': ['vins-et-spiritueux'],

  // Personal services
  'spa': ['esthetique'],
  'massage': ['esthetique', 'kinesitherapeutes-masseurs'],
  'hair': ['coiffeurs'],
  'salon': ['coiffeurs', 'esthetique'],
  'babysitter': ['baby-sitting'],
  'nanny': ['baby-sitting'],
  'photographer': ['photographes'],

  // Shopping
  'jewelry': ['bijouteries-joailleries'],
  'clothes': ['vetements-et-accessoires'],
  'fashion': ['vetements-et-accessoires'],

  // Professional
  'lawyer': ['avocats'],
  'accountant': ['experts-comptables'],
  'notary': ['notaires'],
  'real estate': ['agences-immobilieres', 'conseil-immobilier'],
  'architect': ['architectes-et-agrees-en-architecture'],

  // Health
  'doctor': ['medecins-generalistes', 'medecins-specialistes'],
  'dentist': ['chirurgiens-dentistes'],
  'pharmacy': ['pharmacies'],
  'hospital': ['hopital'],
  'emergency': ['urgences'],
};

// Category mappings
const CATEGORY_MAP: Record<string, string> = {
  'tourism': 'tourisme',
  'home': 'maison',
  'house': 'maison',
  'vehicles': 'vehicules',
  'cars': 'vehicules',
  'food': 'alimentation-boissons',
  'restaurants': 'restaurants-soiree',
  'dining': 'restaurants-soiree',
  'shops': 'boutiques',
  'shopping': 'boutiques',
  'health': 'sante',
  'medical': 'sante',
  'construction': 'construction',
  'building': 'construction',
  'schools': 'ecoles',
  'education': 'ecoles',
  'emergency': 'urgences',
  'admin': 'administrations',
  'government': 'administrations',
  'media': 'communication',
};

async function queryServices(query: string, options: { category?: string; service?: string; limit?: number }) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const limit = options.limit || 10;

  let queryBuilder = supabase
    .from('businesses')
    .select('business_name, city, phone, email, website, services_offered, metadata')
    .eq('discovered_via', 'directory-saintbarth.com')
    .limit(limit);

  // Filter by category
  if (options.category) {
    const cat = CATEGORY_MAP[options.category.toLowerCase()] || options.category;
    queryBuilder = queryBuilder.eq('metadata->>super_category', cat);
  }

  // Filter by service slug
  if (options.service) {
    queryBuilder = queryBuilder.contains('services_offered', [options.service]);
  }

  // Text search - find matching services
  if (query && !options.service) {
    const normalizedQuery = query.toLowerCase();

    // Check for mapped services
    const matchedServices: string[] = [];
    for (const [term, services] of Object.entries(SERVICE_MAP)) {
      if (normalizedQuery.includes(term)) {
        matchedServices.push(...services);
      }
    }

    if (matchedServices.length > 0) {
      // Use OR logic for multiple service types
      const uniqueServices = [...new Set(matchedServices)];
      console.log(`Searching for services: ${uniqueServices.join(', ')}\n`);

      // Supabase doesn't support OR on array contains easily, so we'll do a text search
      queryBuilder = queryBuilder.or(
        uniqueServices.map(s => `services_offered.cs.{${s}}`).join(',')
      );
    } else {
      // Fallback to name/keyword search
      queryBuilder = queryBuilder.or(`business_name.ilike.%${query}%,search_keywords.cs.{${normalizedQuery}}`);
    }
  }

  const { data, error } = await queryBuilder;

  if (error) {
    console.error('Query error:', error);
    process.exit(1);
  }

  return data || [];
}

function formatResults(results: any[]) {
  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  console.log(`Found ${results.length} result(s):\n`);

  for (const biz of results) {
    console.log(`📍 ${biz.business_name}`);
    if (biz.city) console.log(`   Location: ${biz.city}`);
    if (biz.phone) console.log(`   Phone: ${biz.phone}`);
    if (biz.email) console.log(`   Email: ${biz.email}`);
    if (biz.website) console.log(`   Website: ${biz.website}`);
    if (biz.metadata?.category_fr) console.log(`   Service: ${biz.metadata.category_fr}`);
    console.log('');
  }
}

async function main() {
  const args = process.argv.slice(2);

  const categoryArg = args.find(a => a.startsWith('--category='));
  const serviceArg = args.find(a => a.startsWith('--service='));
  const limitArg = args.find(a => a.startsWith('--limit='));

  const query = args.filter(a => !a.startsWith('--')).join(' ');

  const options = {
    category: categoryArg?.split('=')[1],
    service: serviceArg?.split('=')[1],
    limit: limitArg ? parseInt(limitArg.split('=')[1]) : 10,
  };

  if (!query && !options.category && !options.service) {
    console.log('St Barth Concierge Service Query');
    console.log('================================\n');
    console.log('Usage:');
    console.log('  npx tsx scripts/concierge/query-services.ts "villa rental"');
    console.log('  npx tsx scripts/concierge/query-services.ts "car rental"');
    console.log('  npx tsx scripts/concierge/query-services.ts "table repair furniture"');
    console.log('  npx tsx scripts/concierge/query-services.ts --category=tourisme');
    console.log('  npx tsx scripts/concierge/query-services.ts --service=plombiers');
    console.log('');
    console.log('Available categories:', Object.keys(CATEGORY_MAP).join(', '));
    console.log('\nSearchable terms:', Object.keys(SERVICE_MAP).slice(0, 20).join(', '), '...');
    process.exit(0);
  }

  console.log('St Barth Concierge Query');
  console.log('========================\n');

  if (query) console.log(`Query: "${query}"`);
  if (options.category) console.log(`Category: ${options.category}`);
  if (options.service) console.log(`Service: ${options.service}`);
  console.log('');

  const results = await queryServices(query, options);
  formatResults(results);
}

main().catch(console.error);
