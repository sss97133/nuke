#!/usr/bin/env npx tsx
/**
 * Map ECR collections by location
 * Extracts geographic data from collection names
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Location patterns from collection names
const locationPatterns: Record<string, { country: string; city: string; lat: number; lng: number }> = {
  // Middle East
  "qatar": { country: "Qatar", city: "Doha", lat: 25.2854, lng: 51.5310 },
  "al-thani": { country: "Qatar", city: "Doha", lat: 25.2854, lng: 51.5310 },
  "morocco": { country: "Morocco", city: "Casablanca", lat: 33.5731, lng: -7.5898 },
  "oman": { country: "Oman", city: "Muscat", lat: 23.5880, lng: 58.3829 },
  "dubai": { country: "UAE", city: "Dubai", lat: 25.2048, lng: 55.2708 },
  "abu-dhabi": { country: "UAE", city: "Abu Dhabi", lat: 24.4539, lng: 54.3773 },
  "abudhabi": { country: "UAE", city: "Abu Dhabi", lat: 24.4539, lng: 54.3773 },
  "saudi": { country: "Saudi Arabia", city: "Riyadh", lat: 24.7136, lng: 46.6753 },
  "iranian": { country: "Iran", city: "Tehran", lat: 35.6892, lng: 51.3890 },
  "beirut": { country: "Lebanon", city: "Beirut", lat: 33.8938, lng: 35.5018 },
  "kuwait": { country: "Kuwait", city: "Kuwait City", lat: 29.3759, lng: 47.9774 },

  // Europe
  "swiss": { country: "Switzerland", city: "Zurich", lat: 47.3769, lng: 8.5417 },
  "monaco": { country: "Monaco", city: "Monaco", lat: 43.7384, lng: 7.4246 },
  "monegasque": { country: "Monaco", city: "Monaco", lat: 43.7384, lng: 7.4246 },
  "british": { country: "UK", city: "London", lat: 51.5074, lng: -0.1278 },
  "london": { country: "UK", city: "London", lat: 51.5074, lng: -0.1278 },
  "uk-heritage": { country: "UK", city: "London", lat: 51.5074, lng: -0.1278 },
  "french": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522 },
  "paris": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522 },
  "parisian": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522 },
  "german": { country: "Germany", city: "Munich", lat: 48.1351, lng: 11.5820 },
  "munich": { country: "Germany", city: "Munich", lat: 48.1351, lng: 11.5820 },
  "stuttgart": { country: "Germany", city: "Stuttgart", lat: 48.7758, lng: 9.1829 },
  "heppenheim": { country: "Germany", city: "Heppenheim", lat: 49.6417, lng: 8.6361 },
  "bielefeld": { country: "Germany", city: "Bielefeld", lat: 52.0302, lng: 8.5325 },
  "wiesbaden": { country: "Germany", city: "Wiesbaden", lat: 50.0782, lng: 8.2398 },
  "italian": { country: "Italy", city: "Milan", lat: 45.4642, lng: 9.1900 },
  "milan": { country: "Italy", city: "Milan", lat: 45.4642, lng: 9.1900 },
  "maranello": { country: "Italy", city: "Maranello", lat: 44.5294, lng: 10.8656 },
  "monza": { country: "Italy", city: "Monza", lat: 45.5845, lng: 9.2744 },
  "treviso": { country: "Italy", city: "Treviso", lat: 45.6669, lng: 12.2430 },
  "zagato": { country: "Italy", city: "Milan", lat: 45.4642, lng: 9.1900 },
  "warsaw": { country: "Poland", city: "Warsaw", lat: 52.2297, lng: 21.0122 },
  "cracow": { country: "Poland", city: "Krakow", lat: 50.0647, lng: 19.9450 },
  "wroclaw": { country: "Poland", city: "Wroclaw", lat: 51.1079, lng: 17.0385 },
  "katowice": { country: "Poland", city: "Katowice", lat: 50.2649, lng: 19.0238 },
  "inowroclaw": { country: "Poland", city: "Inowroclaw", lat: 52.7996, lng: 18.2608 },
  "tarnow": { country: "Poland", city: "Tarnow", lat: 50.0121, lng: 20.9858 },
  "valais": { country: "Switzerland", city: "Valais", lat: 46.2333, lng: 7.3500 },
  "marbella": { country: "Spain", city: "Marbella", lat: 36.5101, lng: -4.8824 },
  "antwerp": { country: "Belgium", city: "Antwerp", lat: 51.2194, lng: 4.4025 },
  "brussels": { country: "Belgium", city: "Brussels", lat: 50.8503, lng: 4.3517 },
  "dutch": { country: "Netherlands", city: "Amsterdam", lat: 52.3676, lng: 4.9041 },
  "birkerod": { country: "Denmark", city: "Birkerod", lat: 55.8475, lng: 12.4297 },
  "san-marino": { country: "San Marino", city: "San Marino", lat: 43.9424, lng: 12.4578 },
  "gibraltar": { country: "Gibraltar", city: "Gibraltar", lat: 36.1408, lng: -5.3536 },
  "turkey": { country: "Turkey", city: "Istanbul", lat: 41.0082, lng: 28.9784 },
  "istanbul": { country: "Turkey", city: "Istanbul", lat: 41.0082, lng: 28.9784 },

  // Americas
  "toronto": { country: "Canada", city: "Toronto", lat: 43.6532, lng: -79.3832 },
  "texas": { country: "USA", city: "Houston", lat: 29.7604, lng: -95.3698 },
  "houston": { country: "USA", city: "Houston", lat: 29.7604, lng: -95.3698 },
  "florida": { country: "USA", city: "Miami", lat: 25.7617, lng: -80.1918 },
  "california": { country: "USA", city: "Los Angeles", lat: 34.0522, lng: -118.2437 },
  "thermal": { country: "USA", city: "Thermal, CA", lat: 33.6403, lng: -116.1392 },
  "cincinnati": { country: "USA", city: "Cincinnati", lat: 39.1031, lng: -84.5120 },
  "michigan": { country: "USA", city: "Detroit", lat: 42.3314, lng: -83.0458 },
  "fairhope": { country: "USA", city: "Fairhope, AL", lat: 30.5227, lng: -87.9033 },
  "castlepines": { country: "USA", city: "Castle Pines, CO", lat: 39.4583, lng: -104.8969 },
  "atx": { country: "USA", city: "Austin, TX", lat: 30.2672, lng: -97.7431 },
  "bayarea": { country: "USA", city: "San Francisco", lat: 37.7749, lng: -122.4194 },

  // Asia Pacific
  "japanese": { country: "Japan", city: "Tokyo", lat: 35.6762, lng: 139.6503 },
  "tokyo": { country: "Japan", city: "Tokyo", lat: 35.6762, lng: 139.6503 },
  "magarigawa": { country: "Japan", city: "Chiba", lat: 35.6073, lng: 140.1063 },
  "australia": { country: "Australia", city: "Sydney", lat: -33.8688, lng: 151.2093 },
  "sunshinecoast": { country: "Australia", city: "Sunshine Coast", lat: -26.6500, lng: 153.0667 },
  "gosford": { country: "Australia", city: "Gosford", lat: -33.4245, lng: 151.3418 },
  "angkor": { country: "Cambodia", city: "Siem Reap", lat: 13.3671, lng: 103.8448 },

  // Brands as location hints
  "ferrarispa": { country: "Italy", city: "Maranello", lat: 44.5294, lng: 10.8656 },
  "scuderiaferrari": { country: "Italy", city: "Maranello", lat: 44.5294, lng: 10.8656 },
  "porsche-museum": { country: "Germany", city: "Stuttgart", lat: 48.8342, lng: 9.1528 },
  "porsche-classic": { country: "Germany", city: "Stuttgart", lat: 48.8342, lng: 9.1528 },
  "generalmotor": { country: "USA", city: "Detroit", lat: 42.3314, lng: -83.0458 },
  "bmwuk": { country: "UK", city: "Oxford", lat: 51.7520, lng: -1.2577 },
  "astonmartin": { country: "UK", city: "Gaydon", lat: 52.1901, lng: -1.4870 },
  "mclaren": { country: "UK", city: "Woking", lat: 51.3148, lng: -0.5600 },
  "toyotagazoo": { country: "Germany", city: "Cologne", lat: 50.9375, lng: 6.9603 },
  "renault": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522 },
  "dallara": { country: "Italy", city: "Parma", lat: 44.8015, lng: 10.3279 },
  "lamborghini": { country: "Italy", city: "Bologna", lat: 44.4949, lng: 11.3426 },
  "bugatti": { country: "France", city: "Molsheim", lat: 48.5422, lng: 7.4933 },
  "koenigsegg": { country: "Sweden", city: "Angelholm", lat: 56.2425, lng: 12.8623 },
  "pagani": { country: "Italy", city: "Modena", lat: 44.6471, lng: 10.9252 },
};

interface MappedCollection {
  id: string;
  slug: string;
  url: string;
  instagram: string | null;
  country: string;
  city: string;
  lat: number;
  lng: number;
}

async function main() {
  console.log('🗺️  Mapping ECR Collections by Location\n');

  // Fetch all collections
  const { data, error } = await supabase.from('import_queue')
    .select('id, listing_url, listing_title, raw_data')
    .eq('raw_data->>source', 'ecr')
    .eq('raw_data->>type', 'collection');

  if (error) {
    console.error('Error fetching collections:', error);
    return;
  }

  const mapped: MappedCollection[] = [];
  const unmapped: string[] = [];

  data?.forEach(c => {
    const slug = c.listing_url.split('/').pop()?.toLowerCase() || '';
    let location = null;

    for (const [pattern, loc] of Object.entries(locationPatterns)) {
      if (slug.includes(pattern.toLowerCase())) {
        location = loc;
        break;
      }
    }

    if (location) {
      const ig = c.raw_data?.instagram;
      mapped.push({
        id: c.id,
        slug,
        url: c.listing_url,
        instagram: ig !== 'exclusivecarregistry' ? ig : null,
        ...location
      });
    } else {
      unmapped.push(slug);
    }
  });

  console.log(`Mapped: ${mapped.length} collections`);
  console.log(`Unmapped: ${unmapped.length} collections\n`);

  // Stats by country
  const byCountry: Record<string, number> = {};
  mapped.forEach(m => {
    byCountry[m.country] = (byCountry[m.country] || 0) + 1;
  });

  console.log('By Country:');
  Object.entries(byCountry)
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`  ${c}: ${n}`));

  // Generate GeoJSON
  const geojson = {
    type: 'FeatureCollection',
    features: mapped.map(m => ({
      type: 'Feature',
      properties: {
        name: m.slug,
        url: m.url,
        instagram: m.instagram,
        country: m.country,
        city: m.city
      },
      geometry: {
        type: 'Point',
        coordinates: [m.lng, m.lat]
      }
    }))
  };

  // Save to file
  fs.writeFileSync('data/collections-map.geojson', JSON.stringify(geojson, null, 2));
  console.log('\n✅ Saved to data/collections-map.geojson');

  // Also save as CSV for easy import
  const csv = [
    'slug,url,instagram,country,city,lat,lng',
    ...mapped.map(m => `${m.slug},${m.url},${m.instagram || ''},${m.country},${m.city},${m.lat},${m.lng}`)
  ].join('\n');

  fs.writeFileSync('data/collections-map.csv', csv);
  console.log('✅ Saved to data/collections-map.csv');

  // Save unmapped for manual review
  fs.writeFileSync('data/collections-unmapped.txt', unmapped.join('\n'));
  console.log('✅ Saved unmapped list to data/collections-unmapped.txt');

  console.log('\n=== Sample GeoJSON Features ===');
  console.log(JSON.stringify(geojson.features.slice(0, 5), null, 2));
}

main().catch(console.error);
