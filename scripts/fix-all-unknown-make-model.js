#!/usr/bin/env node
/**
 * Fix ALL vehicles with "Unknown" make or model
 * Uses URL parsing fallback to extract make/model from BaT URLs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function titleCase(str) {
  if (!str) return null;
  return str
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function parseMakeModel(parts) {
  const multiWordMakes = {
    'alfa': { full: 'Alfa Romeo', requiresSecond: 'romeo' },
    'mercedes': { full: 'Mercedes-Benz', requiresSecond: 'benz' },
    'land': { full: 'Land Rover', requiresSecond: 'rover' },
    'aston': { full: 'Aston Martin', requiresSecond: 'martin' },
    'factory': { full: 'Factory Five', requiresSecond: 'five' },
  };
  
  if (parts.length >= 2) {
    const firstPart = parts[0].toLowerCase();
    const secondPart = parts[1].toLowerCase();
    
    if (multiWordMakes[firstPart] && secondPart === multiWordMakes[firstPart].requiresSecond) {
      const make = multiWordMakes[firstPart].full;
      const model = parts.slice(2)
        .filter(p => !/^\d{2,3}$/.test(p))
        .map(p => {
          if (/^\d+[a-z]?$/i.test(p) || p.length <= 3 || /^(gt|rs|rsr|s|t)$/i.test(p)) {
            return p.toUpperCase();
          }
          return titleCase(p);
        })
        .join(' ')
        .replace(/\s+\d{2,3}$/, '')
        .trim() || null;
      return { make, model };
    }
  }
  
  if (parts.length >= 2) {
    const make = titleCase(parts[0]);
    let modelParts = parts.slice(1);
    
    while (modelParts.length > 0) {
      const lastPart = modelParts[modelParts.length - 1];
      if (/^\d{1,4}$/.test(lastPart)) {
        if (modelParts.length > 1) {
          const prevPart = modelParts[modelParts.length - 2].toLowerCase();
          if (/[a-z]$/.test(prevPart) || /^(plus|sport|gt|rs|rsr|t|coupe|roadster|convertible|elite|elan|junior|zagato|cheetah|race|car)$/.test(prevPart)) {
            modelParts = modelParts.slice(0, -1);
            continue;
          }
        }
        if (modelParts.length === 2) {
          const firstPart = modelParts[0].toLowerCase();
          if (/^[a-z]+$/.test(firstPart) && !/^(plus|2s|23b|1600)$/.test(firstPart)) {
            modelParts = modelParts.slice(0, -1);
            continue;
          }
        }
      }
      break;
    }
    
    if (modelParts.length > 0 && /^\d{4,}$/.test(modelParts[modelParts.length - 1])) {
      modelParts = modelParts.slice(0, -1);
    }
    
    const model = modelParts
      .map(p => {
        if (/^\d+[a-z]?$/i.test(p) || p.length <= 3 || /^(gt|rs|rsr|s|t)$/i.test(p)) {
          return p.toUpperCase();
        }
        return titleCase(p);
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\b(\d+)\s+(\d)\b/g, '$1.$2')
      .replace(/\s+\d{1,4}$/, '')
      .trim() || titleCase(parts[1]);
    
    return { make, model };
  }
  
  const make = titleCase(parts[0]);
  return { make, model: parts.length > 1 ? titleCase(parts[1]) : null };
}

function parseBatUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  try {
    const matchWithYear = url.match(/\/listing\/(\d{4})-([a-z0-9-]+)\/?$/i);
    if (matchWithYear && matchWithYear[1] && matchWithYear[2]) {
      const year = parseInt(matchWithYear[1], 10);
      if (Number.isFinite(year) && year >= 1885 && year <= new Date().getFullYear() + 1) {
        const parts = matchWithYear[2].split('-').filter(Boolean);
        if (parts.length >= 2) {
          const parsed = parseMakeModel(parts);
          return { year, ...parsed };
        }
      }
    }
    
    const matchNoYear = url.match(/\/listing\/([a-z0-9-]+)\/?$/i);
    if (matchNoYear && matchNoYear[1]) {
      const parts = matchNoYear[1].split('-').filter(Boolean);
      if (parts.length >= 2) {
        const parsed = parseMakeModel(parts);
        return { year: null, ...parsed };
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

async function fixAllUnknown() {
  console.log('🔍 Querying for ALL vehicles with "Unknown" make or model...\n');
  
  let offset = 0;
  const batchSize = 100;
  let totalFixed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  
  while (true) {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model, discovery_url, bat_auction_url')
      .or('make.eq.Unknown,model.eq.Unknown')
      .range(offset, offset + batchSize - 1)
      .order('updated_at', { ascending: false });
    
    if (error) {
      console.error('❌ Error fetching vehicles:', error);
      break;
    }
    
    if (!vehicles || vehicles.length === 0) {
      console.log('✅ No more vehicles to process');
      break;
    }
    
    console.log(`\n📦 Processing batch: ${offset + 1}-${offset + vehicles.length} (${vehicles.length} vehicles)`);
    
    for (const vehicle of vehicles) {
      const url = vehicle.discovery_url || vehicle.bat_auction_url;
      
      if (!url || !url.includes('bringatrailer.com/listing/')) {
        // Try other URL patterns or skip
        if (url && (url.includes('carsandbids.com') || url.includes('mecum.com'))) {
          console.log(`  ⏭️  ${vehicle.id.slice(0, 8)}... - Skipping non-BaT URL (${url.includes('carsandbids') ? 'C&B' : 'Mecum'})`);
          totalSkipped++;
        } else {
          console.log(`  ⏭️  ${vehicle.id.slice(0, 8)}... - No BaT URL found`);
          totalSkipped++;
        }
        continue;
      }
      
      console.log(`  🔧 ${vehicle.id.slice(0, 8)}... - ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}`);
      console.log(`     URL: ${url.split('/listing/')[1]?.split('/')[0] || url.slice(0, 60)}`);
      
      const urlParsed = parseBatUrl(url);
      if (!urlParsed || !urlParsed.make || urlParsed.make.toLowerCase() === 'unknown') {
        console.log(`     ❌ Could not parse make/model from URL`);
        totalSkipped++;
        continue;
      }
      
      const updatePayload = {};
      if (urlParsed.year) updatePayload.year = urlParsed.year;
      if (urlParsed.make) updatePayload.make = urlParsed.make;
      if (urlParsed.model) updatePayload.model = urlParsed.model;
      
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updatePayload)
        .eq('id', vehicle.id);
      
      if (updateError) {
        console.log(`     ❌ Update failed: ${updateError.message}`);
        totalErrors++;
      } else {
        console.log(`     ✅ Fixed: ${urlParsed.year || '?'} ${urlParsed.make} ${urlParsed.model || '?'}`);
        totalFixed++;
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (vehicles.length < batchSize) {
      break; // Last batch
    }
    
    offset += batchSize;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Fixed: ${totalFixed}`);
  console.log(`⏭️  Skipped: ${totalSkipped}`);
  console.log(`❌ Errors: ${totalErrors}`);
  console.log(`📈 Total Processed: ${totalFixed + totalSkipped + totalErrors}`);
  console.log('='.repeat(60));
}

fixAllUnknown().catch(console.error);
