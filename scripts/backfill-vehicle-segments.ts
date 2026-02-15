#!/usr/bin/env npx tsx
/**
 * Backfill vehicle segments based on make/model/year patterns.
 * Run: cd /Users/skylar/nuke && dotenvx run -- npx tsx scripts/backfill-vehicle-segments.ts
 *
 * Uses smaller batches with cursor-based pagination to avoid connection pool timeouts.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Segment assignment rules: checked in order, first match wins
const SEGMENT_RULES: { slug: string; test: (make: string, model: string, year: number | null) => boolean }[] = [
  // Vintage & Pre-War (year-based, checked first)
  {
    slug: 'vintage-prewar',
    test: (_m, _mod, y) => y !== null && y < 1946,
  },
  // Supercars & Exotics (entire makes)
  {
    slug: 'supercars',
    test: (make) => /^(ferrari|lamborghini|mclaren|bugatti|pagani|koenigsegg|rimac)$/i.test(make),
  },
  // Sports Cars (specific makes + models)
  {
    slug: 'sports-cars',
    test: (make, model) => {
      if (/^(lotus|alpine|tvr|caterham|morgan|ariel)$/i.test(make)) return true;
      if (/^porsche$/i.test(make) && /911|carrera|gt3|gt2|speedster|targa/i.test(model)) return true;
      if (/^chevrolet$/i.test(make) && /corvette/i.test(model)) return true;
      if (/^(aston martin|aston)$/i.test(make) && /vantage|db[0-9]|dbs/i.test(model)) return true;
      if (/^mazda$/i.test(make) && /miata|mx-5|mx5/i.test(model)) return true;
      if (/^nissan$/i.test(make) && /370z|350z|300zx|z$/i.test(model)) return true;
      if (/^bmw$/i.test(make) && /z[0-9]|z3|z4|z8/i.test(model)) return true;
      return false;
    },
  },
  // Muscle Cars
  {
    slug: 'muscle-cars',
    test: (make, model) => {
      if (/^(ford|mercury)$/i.test(make) && /mustang|shelby|boss|mach/i.test(model)) return true;
      if (/^chevrolet$/i.test(make) && /camaro|chevelle|nova|impala ss|el camino/i.test(model)) return true;
      if (/^dodge$/i.test(make) && /challenger|charger|dart|super bee|demon/i.test(model)) return true;
      if (/^plymouth$/i.test(make) && /barracuda|cuda|road runner|gtx|duster/i.test(model)) return true;
      if (/^pontiac$/i.test(make) && /gto|firebird|trans am|judge/i.test(model)) return true;
      if (/^buick$/i.test(make) && /gs|gsx|skylark|riviera/i.test(model)) return true;
      if (/^oldsmobile$/i.test(make) && /442|cutlass|w-30|hurst/i.test(model)) return true;
      if (/^amc$/i.test(make) && /javelin|amx|machine/i.test(model)) return true;
      return false;
    },
  },
  // Luxury & GT
  {
    slug: 'luxury-gt',
    test: (make, model) => {
      if (/^(bentley|rolls-royce|rolls royce|maybach|maserati)$/i.test(make)) return true;
      if (/^(mercedes-benz|mercedes)$/i.test(make) && /sl|s-class|s class|amg gt|300sl|gullwing/i.test(model)) return true;
      if (/^(aston martin|aston)$/i.test(make) && /db[0-9]|rapide|lagonda/i.test(model)) return true;
      if (/^cadillac$/i.test(make) && /eldorado|deville|fleetwood/i.test(model)) return true;
      if (/^lincoln$/i.test(make) && /continental|mark/i.test(model)) return true;
      if (/^jaguar$/i.test(make) && /xj|xk|xjs/i.test(model)) return true;
      return false;
    },
  },
  // Off-Road & Trucks
  {
    slug: 'off-road-trucks',
    test: (make, model) => {
      if (/^(land rover|landrover|jeep|hummer|am general)$/i.test(make)) return true;
      if (/^toyota$/i.test(make) && /land cruiser|fj|4runner|hilux|tacoma|tundra/i.test(model)) return true;
      if (/^ford$/i.test(make) && /bronco|f-?1[05]0|f-?250|ranger|raptor/i.test(model)) return true;
      if (/^chevrolet$/i.test(make) && /blazer|k[0-9]|c[0-9]|suburban|silverado|colorado/i.test(model)) return true;
      if (/^gmc$/i.test(make) && /jimmy|sierra|yukon/i.test(model)) return true;
      if (/^dodge$/i.test(make) && /power wagon|ram|dakota/i.test(model)) return true;
      if (/^nissan$/i.test(make) && /patrol|frontier/i.test(model)) return true;
      if (/^(international|scout|international harvester)$/i.test(make)) return true;
      return false;
    },
  },
  // Japanese Classics
  {
    slug: 'japanese-classics',
    test: (make, model) => {
      if (/^datsun$/i.test(make)) return true;
      if (/^toyota$/i.test(make) && /supra|2000gt|ae86|celica|mr2|corolla/i.test(model)) return true;
      if (/^honda$/i.test(make) && /nsx|s2000|s600|s800|civic|crx|integra/i.test(model)) return true;
      if (/^mazda$/i.test(make) && /rx-?7|rx-?3|cosmo|rx-?8|rotary/i.test(model)) return true;
      if (/^nissan$/i.test(make) && /skyline|gt-r|gtr|silvia|240z|260z|280z|fairlady|240sx/i.test(model)) return true;
      if (/^subaru$/i.test(make) && /wrx|sti|impreza|brz/i.test(model)) return true;
      if (/^mitsubishi$/i.test(make) && /evo|lancer|eclipse|3000gt/i.test(model)) return true;
      return false;
    },
  },
  // German Engineering
  {
    slug: 'german-engineering',
    test: (make, model) => {
      if (/^porsche$/i.test(make) && !/911|carrera|gt3|gt2|speedster|targa/i.test(model)) return true;
      if (/^bmw$/i.test(make) && !/z[0-9]|z3|z4|z8/i.test(model)) return true;
      if (/^(mercedes-benz|mercedes)$/i.test(make) && !/sl|s-class|s class|amg gt|300sl|gullwing/i.test(model)) return true;
      if (/^(audi|volkswagen|vw)$/i.test(make)) return true;
      if (/^opel$/i.test(make)) return true;
      return false;
    },
  },
  // British Classics
  {
    slug: 'british-classics',
    test: (make, model) => {
      if (/^(triumph|austin-healey|austin healey|mg|sunbeam|riley|wolseley)$/i.test(make)) return true;
      if (/^jaguar$/i.test(make) && /e-type|xk[0-9]|mk|ss|d-type|c-type/i.test(model)) return true;
      if (/^mini$/i.test(make)) return true;
      return false;
    },
  },
  // American Classics
  {
    slug: 'american-classics',
    test: (make) => {
      return /^(studebaker|hudson|nash|packard|desoto|edsel|kaiser|willys|crosley|tucker|cord|auburn|duesenberg|pierce-arrow|stutz)$/i.test(make);
    },
  },
  // Racing Heritage
  {
    slug: 'racing-heritage',
    test: (_make, model) => {
      return /race|rally|competition|group [a-c]|homologation|gt[0-9]|cup|trophy|spec|track/i.test(model);
    },
  },
  // Modern Performance
  {
    slug: 'modern-performance',
    test: (make, model, year) => {
      if (year !== null && year < 2000) return false;
      if (/^dodge$/i.test(make) && /viper|hellcat|demon|srt/i.test(model)) return true;
      if (/^ford$/i.test(make) && /gt$|gt40|focus rs|fiesta st/i.test(model)) return true;
      if (/^chevrolet$/i.test(make) && /corvette|camaro zl1|camaro ss/i.test(model)) return true;
      if (/^nissan$/i.test(make) && /gt-r|gtr|nismo/i.test(model)) return true;
      if (/^(tesla|rivian|lucid)$/i.test(make)) return true;
      return false;
    },
  },
  // Convertibles & Roadsters
  {
    slug: 'convertibles',
    test: (_make, model) => {
      return /convertible|roadster|cabriolet|spider|spyder|drophead|volante/i.test(model);
    },
  },
  // Wagons & Vans
  {
    slug: 'wagons-vans',
    test: (make, model) => {
      if (/wagon|estate|avant|touring|van|bus|kombi|microbus|westfalia|sportsmobile/i.test(model)) return true;
      if (/^volkswagen$/i.test(make) && /bus|van|type 2|transporter/i.test(model)) return true;
      return false;
    },
  },
  // Microcars & Oddities
  {
    slug: 'microcars-oddities',
    test: (make) => {
      return /^(isetta|messerschmitt|goggomobil|peel|reliant|citroen|fiat|vespa|cushman|amphicar|delorean)$/i.test(make);
    },
  },
];

async function backfill() {
  console.log('Starting vehicle segment backfill...\n');

  const BATCH_SIZE = 500;
  let lastId = '00000000-0000-0000-0000-000000000000';
  let updated = 0;
  let skipped = 0;
  let processed = 0;
  const segmentCounts: Record<string, number> = {};

  while (true) {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, make, model, year')
      .is('deleted_at', null)
      .or('sale_price.gt.0,sold_price.gt.0')
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      console.error('Fetch error:', error.message);
      // Wait and retry on connection pool issues
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    if (!vehicles || vehicles.length === 0) break;

    lastId = vehicles[vehicles.length - 1].id;

    // Group by segment for batch updates
    const segmentBatches: Record<string, string[]> = {};

    for (const v of vehicles) {
      const make = (v.make || '').trim();
      const model = (v.model || '').trim();
      const year = v.year;

      if (!make || make.length < 2) { skipped++; continue; }

      let matched = false;
      for (const rule of SEGMENT_RULES) {
        if (rule.test(make, model, year)) {
          if (!segmentBatches[rule.slug]) segmentBatches[rule.slug] = [];
          segmentBatches[rule.slug].push(v.id);
          segmentCounts[rule.slug] = (segmentCounts[rule.slug] || 0) + 1;
          matched = true;
          break;
        }
      }
      if (!matched) skipped++;
    }

    // Batch update each segment
    for (const [slug, ids] of Object.entries(segmentBatches)) {
      // Split into chunks of 100 for Supabase limits
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({ segment_slug: slug })
          .in('id', chunk);

        if (updateError) {
          console.error(`Update error for ${slug}:`, updateError.message);
          await new Promise(r => setTimeout(r, 1000));
        } else {
          updated += chunk.length;
        }
      }
    }

    processed += vehicles.length;
    process.stdout.write(`\rProcessed ${processed} vehicles, ${updated} categorized, ${skipped} unmatched`);

    if (vehicles.length < BATCH_SIZE) break;

    // Small delay between batches to avoid overwhelming the pool
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n\nSegment distribution:');
  const sorted = Object.entries(segmentCounts).sort((a, b) => b[1] - a[1]);
  for (const [slug, count] of sorted) {
    console.log(`  ${slug.padEnd(25)} ${count.toString().padStart(8)}`);
  }

  console.log(`\nTotal: ${processed} processed, ${updated} categorized, ${skipped} unmatched`);
  if (processed > 0) {
    console.log(`Coverage: ${((updated / processed) * 100).toFixed(1)}%`);
  }
}

backfill().catch(console.error);
