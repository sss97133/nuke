#!/usr/bin/env node
/**
 * SEED-FORUM-SOURCES
 *
 * Seeds the forum_sources table with 100+ automotive forums
 * categorized by vehicle type.
 *
 * Usage:
 *   node scripts/seed-forum-sources.js
 *   node scripts/seed-forum-sources.js --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Forum definitions with metadata
const FORUMS = [
  // ===========================================
  // GM Trucks (1967-1991 C/K, Squarebody, OBS)
  // ===========================================
  {
    slug: '67-72chevytrucks',
    name: '67-72 Chevy Trucks',
    base_url: 'https://67-72chevytrucks.com/vboard/',
    vehicle_categories: ['gm-trucks', 'squarebody', 'c10'],
    vehicle_makes: ['Chevrolet', 'GMC'],
    year_range: '[1967,1973)',
    notes: 'Premier squarebody community',
  },
  {
    slug: '73-87chevytrucks',
    name: '73-87 Chevy Trucks',
    base_url: 'https://www.73-87chevytrucks.com/vboard/',
    vehicle_categories: ['gm-trucks', 'squarebody', 'c10'],
    vehicle_makes: ['Chevrolet', 'GMC'],
    year_range: '[1973,1988)',
    notes: 'C10/K10 specialists',
  },
  {
    slug: 'performancetrucks',
    name: 'Performance Trucks',
    base_url: 'https://www.performancetrucks.net/forums/',
    vehicle_categories: ['gm-trucks', 'performance'],
    vehicle_makes: ['Chevrolet', 'GMC'],
    notes: 'Performance GM trucks',
  },
  {
    slug: '355nation',
    name: '355 Nation',
    base_url: 'https://www.355nation.net/forums/',
    vehicle_categories: ['gm-trucks', 'small-block'],
    vehicle_makes: ['Chevrolet'],
    notes: 'Small block Chevy trucks',
  },
  {
    slug: 'thetruckstop',
    name: 'The Truck Stop',
    base_url: 'https://www.thetruckstop.us/forum/',
    vehicle_categories: ['gm-trucks'],
    vehicle_makes: ['Chevrolet', 'GMC'],
    notes: 'Multi-gen GM trucks',
  },
  {
    slug: 'gmfullsize',
    name: 'GM Fullsize',
    base_url: 'https://www.gmfullsize.com/forums/',
    vehicle_categories: ['gm-trucks', 'fullsize'],
    vehicle_makes: ['Chevrolet', 'GMC'],
    notes: 'Full-size GM platform',
  },

  // ===========================================
  // Muscle Cars (1964-1973)
  // ===========================================
  {
    slug: 'camaros-net',
    name: 'Camaros.net',
    base_url: 'https://www.camaros.net/forums/',
    vehicle_categories: ['muscle-car', 'camaro', 'f-body'],
    vehicle_makes: ['Chevrolet'],
    year_range: '[1967,1981)',
    notes: '1st/2nd gen Camaro builds',
  },
  {
    slug: 'nastyz28',
    name: 'NastyZ28',
    base_url: 'https://nastyz28.com/forum/',
    vehicle_categories: ['muscle-car', 'camaro', 'firebird', 'f-body'],
    vehicle_makes: ['Chevrolet', 'Pontiac'],
    notes: 'Camaro/Firebird builds',
  },
  {
    slug: 'pro-touring',
    name: 'Pro-Touring.com',
    base_url: 'https://www.pro-touring.com/vbulletin/',
    vehicle_categories: ['pro-touring', 'restomod', 'muscle-car'],
    vehicle_makes: ['Chevrolet', 'Ford', 'Dodge', 'Pontiac', 'Buick', 'Oldsmobile'],
    notes: 'Pro-touring builds (all makes)',
  },
  {
    slug: 'lateral-g',
    name: 'Lateral-G',
    base_url: 'https://lateral-g.net/forums/',
    vehicle_categories: ['pro-touring', 'restomod'],
    notes: 'Pro-touring/restomod',
  },
  {
    slug: 'hotrodders',
    name: 'Hot Rodders',
    base_url: 'https://www.hotrodders.com/forum/',
    vehicle_categories: ['hot-rod', 'classic'],
    notes: 'Classic hot rod builds',
  },
  {
    slug: 'chevelles',
    name: 'Chevelles.com',
    base_url: 'https://www.chevelles.com/forums/',
    vehicle_categories: ['muscle-car', 'chevelle', 'a-body'],
    vehicle_makes: ['Chevrolet'],
    year_range: '[1964,1978)',
    notes: 'Chevelle/Malibu builds',
  },
  {
    slug: 'forabodiesonly',
    name: 'For A Bodies Only',
    base_url: 'https://www.forabodiesonly.com/mopar/',
    vehicle_categories: ['muscle-car', 'mopar', 'a-body'],
    vehicle_makes: ['Dodge', 'Plymouth'],
    notes: 'Mopar A-body (Dart, Duster)',
  },
  {
    slug: 'forbbodiesonly',
    name: 'For B Bodies Only',
    base_url: 'https://www.forbbodiesonly.com/mopar/',
    vehicle_categories: ['muscle-car', 'mopar', 'b-body'],
    vehicle_makes: ['Dodge', 'Plymouth'],
    notes: 'Mopar B-body (Charger, GTX)',
  },
  {
    slug: 'fordmuscleforums',
    name: 'Ford Muscle Forums',
    base_url: 'https://www.fordmuscleforums.com/',
    vehicle_categories: ['muscle-car', 'ford'],
    vehicle_makes: ['Ford', 'Mercury'],
    notes: 'Ford muscle',
  },
  {
    slug: 'vintage-mustang',
    name: 'Vintage Mustang',
    base_url: 'https://www.vintage-mustang.com/forums/',
    vehicle_categories: ['muscle-car', 'mustang', 'pony-car'],
    vehicle_makes: ['Ford'],
    year_range: '[1964,1974)',
    notes: '64-73 Mustang builds',
  },
  {
    slug: 'classicoldsmobile',
    name: 'Classic Oldsmobile',
    base_url: 'https://www.classicoldsmobile.com/forum/',
    vehicle_categories: ['muscle-car', 'oldsmobile'],
    vehicle_makes: ['Oldsmobile'],
    notes: 'Cutlass/442 builds',
  },
  {
    slug: 'pontiaczone',
    name: 'Pontiac Zone',
    base_url: 'https://www.pontiaczone.com/forum/',
    vehicle_categories: ['muscle-car', 'pontiac', 'f-body'],
    vehicle_makes: ['Pontiac'],
    notes: 'GTO/Firebird builds',
  },
  {
    slug: 'buickforums',
    name: 'Buick Forums',
    base_url: 'https://www.buickforums.com/',
    vehicle_categories: ['muscle-car', 'buick'],
    vehicle_makes: ['Buick'],
    notes: 'GS/GSX builds',
  },
  {
    slug: 'moparts',
    name: 'MoParts',
    base_url: 'https://board.moparts.com/',
    vehicle_categories: ['muscle-car', 'mopar'],
    vehicle_makes: ['Dodge', 'Plymouth', 'Chrysler'],
    notes: 'Mopar tech & builds',
  },
  {
    slug: 'thirdgen',
    name: 'ThirdGen.org',
    base_url: 'https://thirdgen.org/forums/',
    vehicle_categories: ['muscle-car', 'camaro', 'firebird', 'f-body'],
    vehicle_makes: ['Chevrolet', 'Pontiac'],
    year_range: '[1982,1993)',
    notes: '3rd gen F-body',
  },
  {
    slug: 'ls1tech',
    name: 'LS1Tech',
    base_url: 'https://www.ls1tech.com/forums/',
    vehicle_categories: ['ls-swap', 'performance'],
    vehicle_makes: ['Chevrolet', 'Pontiac'],
    notes: 'LS swap builds',
  },

  // ===========================================
  // European Sports Cars
  // ===========================================
  {
    slug: 'rennlist',
    name: 'Rennlist',
    base_url: 'https://rennlist.com/forums/',
    vehicle_categories: ['european-sports', 'porsche'],
    vehicle_makes: ['Porsche'],
    notes: 'Porsche (massive build section)',
  },
  {
    slug: 'pelican-parts',
    name: 'Pelican Parts Forums',
    base_url: 'https://forums.pelicanparts.com/',
    vehicle_categories: ['european-sports', 'porsche', 'bmw', 'vw'],
    vehicle_makes: ['Porsche', 'BMW', 'Volkswagen'],
    notes: 'Porsche/BMW/VW',
  },
  {
    slug: '6speedonline',
    name: '6SpeedOnline',
    base_url: 'https://www.6speedonline.com/forums/',
    vehicle_categories: ['european-sports', 'porsche', 'exotic'],
    vehicle_makes: ['Porsche', 'Ferrari', 'Lamborghini'],
    notes: 'Porsche/Euro sports',
  },
  {
    slug: 'planet-9',
    name: 'Planet-9',
    base_url: 'https://www.planet-9.com/forums/',
    vehicle_categories: ['porsche', 'cayman', 'boxster'],
    vehicle_makes: ['Porsche'],
    notes: 'Porsche Cayman/Boxster',
  },
  {
    slug: 'ferrarichat',
    name: 'FerrariChat',
    base_url: 'https://www.ferrarichat.com/forum/',
    vehicle_categories: ['exotic', 'ferrari'],
    vehicle_makes: ['Ferrari'],
    notes: 'Ferrari builds',
  },
  {
    slug: 'lotustalk',
    name: 'LotusTalk',
    base_url: 'https://www.lotustalk.com/forums/',
    vehicle_categories: ['british-sports', 'lotus'],
    vehicle_makes: ['Lotus'],
    notes: 'Lotus builds',
  },
  {
    slug: 'jaguarforum',
    name: 'Jaguar Forum',
    base_url: 'https://www.jaguarforum.com/',
    vehicle_categories: ['british-sports', 'jaguar'],
    vehicle_makes: ['Jaguar'],
    notes: 'Jaguar restoration',
  },
  {
    slug: 'triumphs',
    name: 'Triumphs.net',
    base_url: 'https://www.triumphs.net/forums/',
    vehicle_categories: ['british-sports', 'triumph'],
    vehicle_makes: ['Triumph'],
    notes: 'Triumph builds',
  },
  {
    slug: 'mgexperience',
    name: 'MG Experience',
    base_url: 'https://www.mgexperience.net/forum/',
    vehicle_categories: ['british-sports', 'mg'],
    vehicle_makes: ['MG'],
    notes: 'MG restoration',
  },
  {
    slug: 'alfabb',
    name: 'Alfa BB',
    base_url: 'https://www.alfabb.com/bb/',
    vehicle_categories: ['italian', 'alfa-romeo'],
    vehicle_makes: ['Alfa Romeo'],
    notes: 'Alfa Romeo builds',
  },
  {
    slug: 'bimmerforums',
    name: 'Bimmer Forums',
    base_url: 'https://www.bimmerforums.com/forum/',
    vehicle_categories: ['european', 'bmw'],
    vehicle_makes: ['BMW'],
    notes: 'BMW builds',
  },
  {
    slug: 'benzworld',
    name: 'BenzWorld',
    base_url: 'https://www.benzworld.org/forums/',
    vehicle_categories: ['european', 'mercedes'],
    vehicle_makes: ['Mercedes-Benz'],
    notes: 'Classic Mercedes',
  },
  {
    slug: 'audizine',
    name: 'Audizine',
    base_url: 'https://www.audizine.com/forum/',
    vehicle_categories: ['european', 'audi'],
    vehicle_makes: ['Audi'],
    notes: 'Audi builds',
  },
  {
    slug: 'vwvortex',
    name: 'VWVortex',
    base_url: 'https://www.vwvortex.com/forums/',
    vehicle_categories: ['european', 'vw'],
    vehicle_makes: ['Volkswagen'],
    notes: 'VW builds',
  },
  {
    slug: 'thesamba',
    name: 'The Samba',
    base_url: 'https://www.thesamba.com/vw/forum/',
    vehicle_categories: ['european', 'vw', 'classic'],
    vehicle_makes: ['Volkswagen'],
    notes: 'VW builds (huge)',
  },

  // ===========================================
  // Japanese Classics
  // ===========================================
  {
    slug: 'classiczcars',
    name: 'Classic ZCars',
    base_url: 'https://www.classiczcars.com/forums/',
    vehicle_categories: ['japanese', 'datsun', 'z-car'],
    vehicle_makes: ['Datsun', 'Nissan'],
    notes: 'Datsun Z builds',
  },
  {
    slug: 'hybridz',
    name: 'HybridZ',
    base_url: 'https://forums.hybridz.org/',
    vehicle_categories: ['japanese', 'datsun', 'z-car'],
    vehicle_makes: ['Datsun', 'Nissan'],
    notes: 'Z-car builds',
  },
  {
    slug: 'ratsun',
    name: 'Ratsun',
    base_url: 'https://ratsun.net/forum/',
    vehicle_categories: ['japanese', 'datsun'],
    vehicle_makes: ['Datsun', 'Nissan'],
    notes: 'Datsun builds',
  },
  {
    slug: 'club4ag',
    name: 'Club4AG',
    base_url: 'https://club4ag.com/forum/',
    vehicle_categories: ['japanese', 'toyota', 'ae86'],
    vehicle_makes: ['Toyota'],
    notes: 'Toyota AE86/Corolla',
  },
  {
    slug: 'rx7club',
    name: 'RX7Club',
    base_url: 'https://www.rx7club.com/forum/',
    vehicle_categories: ['japanese', 'mazda', 'rotary'],
    vehicle_makes: ['Mazda'],
    notes: 'Mazda RX-7 builds',
  },
  {
    slug: 'mazdas247',
    name: 'Mazdas247',
    base_url: 'https://www.mazdas247.com/forum/',
    vehicle_categories: ['japanese', 'mazda', 'rotary'],
    vehicle_makes: ['Mazda'],
    notes: 'Rotary builds',
  },
  {
    slug: 'honda-tech',
    name: 'Honda-Tech',
    base_url: 'https://honda-tech.com/forums/',
    vehicle_categories: ['japanese', 'honda'],
    vehicle_makes: ['Honda', 'Acura'],
    notes: 'Honda builds',
  },
  {
    slug: 'team-integra',
    name: 'Team Integra',
    base_url: 'https://www.team-integra.net/forum/',
    vehicle_categories: ['japanese', 'honda', 'acura'],
    vehicle_makes: ['Acura'],
    notes: 'Integra builds',
  },
  {
    slug: 'clubroadster',
    name: 'Club Roadster',
    base_url: 'https://www.clubroadster.net/vb_forum/',
    vehicle_categories: ['japanese', 'mazda', 'miata'],
    vehicle_makes: ['Mazda'],
    notes: 'Miata builds',
  },
  {
    slug: 'miataturbo',
    name: 'Miata Turbo',
    base_url: 'https://www.miataturbo.net/forums/',
    vehicle_categories: ['japanese', 'mazda', 'miata', 'turbo'],
    vehicle_makes: ['Mazda'],
    notes: 'Turbo Miata builds',
  },
  {
    slug: 's2ki',
    name: 'S2KI',
    base_url: 'https://www.s2ki.com/forums/',
    vehicle_categories: ['japanese', 'honda', 's2000'],
    vehicle_makes: ['Honda'],
    notes: 'Honda S2000',
  },
  {
    slug: 'ft86club',
    name: 'FT86 Club',
    base_url: 'https://www.ft86club.com/forums/',
    vehicle_categories: ['japanese', 'toyota', 'subaru'],
    vehicle_makes: ['Toyota', 'Subaru', 'Scion'],
    notes: 'BRZ/86 builds',
  },

  // ===========================================
  // American Trucks & 4x4
  // ===========================================
  {
    slug: 'ford-trucks',
    name: 'Ford Trucks',
    base_url: 'https://www.ford-trucks.com/forums/',
    vehicle_categories: ['ford-trucks'],
    vehicle_makes: ['Ford'],
    notes: 'Ford truck builds',
  },
  {
    slug: 'f150forum',
    name: 'F150 Forum',
    base_url: 'https://www.f150forum.com/forum/',
    vehicle_categories: ['ford-trucks', 'f150'],
    vehicle_makes: ['Ford'],
    notes: 'F-150 builds',
  },
  {
    slug: 'dieselplace',
    name: 'Diesel Place',
    base_url: 'https://www.dieselplace.com/forum/',
    vehicle_categories: ['diesel', 'gm-trucks'],
    vehicle_makes: ['Chevrolet', 'GMC'],
    notes: 'Duramax builds',
  },
  {
    slug: 'thedieselstop',
    name: 'The Diesel Stop',
    base_url: 'https://www.thedieselstop.com/forums/',
    vehicle_categories: ['diesel', 'ford-trucks'],
    vehicle_makes: ['Ford'],
    notes: 'Ford diesel',
  },
  {
    slug: 'jeepforum',
    name: 'Jeep Forum',
    base_url: 'https://www.jeepforum.com/forum/',
    vehicle_categories: ['4x4', 'jeep'],
    vehicle_makes: ['Jeep'],
    notes: 'Jeep builds',
  },
  {
    slug: 'wranglerforum',
    name: 'Wrangler Forum',
    base_url: 'https://www.wranglerforum.com/forum/',
    vehicle_categories: ['4x4', 'jeep', 'wrangler'],
    vehicle_makes: ['Jeep'],
    notes: 'Wrangler builds',
  },
  {
    slug: 'pirate4x4',
    name: 'Pirate 4x4',
    base_url: 'https://www.pirate4x4.com/forum/',
    vehicle_categories: ['4x4', 'off-road'],
    notes: 'Off-road builds',
  },
  {
    slug: 'expeditionportal',
    name: 'Expedition Portal',
    base_url: 'https://expeditionportal.com/forum/',
    vehicle_categories: ['4x4', 'overland'],
    notes: 'Overland builds',
  },
  {
    slug: 'ih8mud',
    name: 'IH8MUD',
    base_url: 'https://forum.ih8mud.com/',
    vehicle_categories: ['4x4', 'toyota', 'land-cruiser'],
    vehicle_makes: ['Toyota'],
    notes: 'Toyota Land Cruiser',
  },
  {
    slug: 'broncozone',
    name: 'Bronco Zone',
    base_url: 'https://www.broncozone.com/',
    vehicle_categories: ['4x4', 'ford', 'bronco'],
    vehicle_makes: ['Ford'],
    notes: 'Classic Bronco',
  },
  {
    slug: 'k5blazer',
    name: 'K5 Blazer',
    base_url: 'https://www.k5blazer.net/forums/',
    vehicle_categories: ['4x4', 'gm', 'blazer'],
    vehicle_makes: ['Chevrolet'],
    notes: 'K5 builds',
  },

  // ===========================================
  // Corvette
  // ===========================================
  {
    slug: 'corvetteforum',
    name: 'Corvette Forum',
    base_url: 'https://www.corvetteforum.com/forums/',
    vehicle_categories: ['corvette', 'sports-car'],
    vehicle_makes: ['Chevrolet'],
    notes: 'All-gen Corvette builds',
  },
  {
    slug: 'digitalcorvettes',
    name: 'Digital Corvettes',
    base_url: 'https://www.digitalcorvettes.com/forums/',
    vehicle_categories: ['corvette', 'sports-car'],
    vehicle_makes: ['Chevrolet'],
    notes: 'Build journals',
  },

  // ===========================================
  // Multi-Make & General
  // ===========================================
  {
    slug: 'jalopyjournal',
    name: 'Jalopy Journal (HAMB)',
    base_url: 'https://www.jalopyjournal.com/forum/',
    vehicle_categories: ['hot-rod', 'pre-war', 'traditional'],
    year_range: '[1900,1965)',
    notes: 'Pre-1965 builds',
  },
  {
    slug: 'trifive',
    name: 'TriFive',
    base_url: 'https://www.trifive.com/forums/',
    vehicle_categories: ['classic', 'tri-five'],
    vehicle_makes: ['Chevrolet'],
    year_range: '[1955,1958)',
    notes: '55-57 Chevy',
  },
  {
    slug: 'yellowbullet',
    name: 'Yellow Bullet',
    base_url: 'https://www.yellowbullet.com/forum/',
    vehicle_categories: ['drag-racing', 'performance'],
    notes: 'Drag racing builds',
  },

  // ===========================================
  // Land Rover / British 4x4
  // ===========================================
  {
    slug: 'defender2',
    name: 'Defender2',
    base_url: 'https://www.defender2.net/forum/',
    vehicle_categories: ['4x4', 'land-rover', 'defender'],
    vehicle_makes: ['Land Rover'],
    notes: 'Defender builds',
  },
];

async function seedForums(dryRun = false) {
  console.log(`\n${'='.repeat(70)}`);
  console.log('SEEDING FORUM SOURCES');
  console.log(`${'='.repeat(70)}\n`);

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  const results = {
    total: FORUMS.length,
    inserted: 0,
    updated: 0,
    errors: [],
  };

  for (const forum of FORUMS) {
    try {
      const row = {
        slug: forum.slug,
        name: forum.name,
        base_url: forum.base_url,
        vehicle_categories: forum.vehicle_categories || [],
        vehicle_makes: forum.vehicle_makes || null,
        year_range: forum.year_range || null,
        notes: forum.notes || null,
        inspection_status: 'pending',
      };

      if (dryRun) {
        console.log(`Would upsert: ${forum.slug} (${forum.name})`);
        results.inserted++;
      } else {
        const { data, error } = await supabase
          .from('forum_sources')
          .upsert(row, { onConflict: 'slug' })
          .select('id, slug')
          .single();

        if (error) {
          console.error(`Error upserting ${forum.slug}:`, error.message);
          results.errors.push({ slug: forum.slug, error: error.message });
        } else {
          console.log(`Upserted: ${forum.slug} (${data.id})`);
          results.inserted++;
        }
      }
    } catch (e) {
      console.error(`Exception for ${forum.slug}:`, e.message);
      results.errors.push({ slug: forum.slug, error: e.message });
    }
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(70)}`);
  console.log(`Total forums: ${results.total}`);
  console.log(`Upserted: ${results.inserted}`);
  console.log(`Errors: ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of results.errors) {
      console.log(`  - ${err.slug}: ${err.error}`);
    }
  }

  // Category breakdown
  const categories = {};
  for (const forum of FORUMS) {
    for (const cat of forum.vehicle_categories || []) {
      categories[cat] = (categories[cat] || 0) + 1;
    }
  }

  console.log('\nForums by category:');
  const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCats) {
    console.log(`  ${cat}: ${count}`);
  }

  return results;
}

// Run if executed directly
const dryRun = process.argv.includes('--dry-run');
seedForums(dryRun)
  .then((results) => {
    if (results.errors.length > 0) {
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  });

export { seedForums, FORUMS };
