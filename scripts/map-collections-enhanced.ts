#!/usr/bin/env npx tsx
/**
 * Enhanced Collection Location Mapping
 * Includes researched locations from web searches
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// RESEARCHED LOCATIONS - from web searches
const researchedLocations: Record<string, { country: string; city: string; lat: number; lng: number; source?: string }> = {
  // Celebrities & Notable Collectors
  "craig-liebermans-car-collection": { country: "USA", city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437, source: "Fast & Furious technical advisor" },
  "george-harrisons-car-collection": { country: "UK", city: "Henley-on-Thames", lat: 51.5354, lng: -0.9014, source: "Friar Park estate" },
  "swizz-beatzs-car-collection": { country: "USA", city: "La Jolla, CA", lat: 32.8328, lng: -117.2713, source: "Razor House" },
  "fernando-alonsos-car-collection": { country: "Monaco", city: "Monaco", lat: 43.7384, lng: 7.4246, source: "F1 driver residence" },
  "bruno-sennas-car-collection": { country: "Monaco", city: "Monaco", lat: 43.7384, lng: 7.4246, source: "F1 driver residence" },
  "liam-howletts-car-collection": { country: "UK", city: "Essex", lat: 51.7343, lng: 0.4691, source: "The Prodigy member" },
  "rowan-atkinsons-car-collection": { country: "UK", city: "Oxfordshire", lat: 51.7520, lng: -1.2577, source: "Mr. Bean actor" },
  "jay-lenos-car-collection": { country: "USA", city: "Burbank, CA", lat: 34.1808, lng: -118.3090, source: "Jay Leno's Garage" },
  "jerry-seinfelds-car-collection": { country: "USA", city: "New York, NY", lat: 40.7128, lng: -74.0060, source: "Comedian" },
  "kimi-raikkonens-car-collection": { country: "Switzerland", city: "Baar", lat: 47.1962, lng: 8.5294, source: "F1 champion" },
  "dougdemuro": { country: "USA", city: "San Diego, CA", lat: 32.7157, lng: -117.1611, source: "Car reviewer" },
  "salomondrin": { country: "USA", city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437, source: "YouTube car collector" },
  "therealtavarish": { country: "USA", city: "Florida", lat: 27.9506, lng: -82.4572, source: "YouTube car builder" },
  "dailydrivenexotics": { country: "Canada", city: "Vancouver", lat: 49.2827, lng: -123.1207, source: "YouTube channel" },

  // Royal & Billionaire Families
  "the-rothschild-family-collection": { country: "Switzerland", city: "Geneva", lat: 46.2044, lng: 6.1432, source: "Banking family" },
  "althaniroyalfamily": { country: "Qatar", city: "Doha", lat: 25.2854, lng: 51.5310, source: "Qatar royal family" },
  "the-moroccan-royal-family-collection": { country: "Morocco", city: "Rabat", lat: 34.0209, lng: -6.8416, source: "Morocco royal family" },
  "oman-royal-family-collection": { country: "Oman", city: "Muscat", lat: 23.5880, lng: 58.3829, source: "Oman royal family" },
  "the-iranian-royal-family-collection": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522, source: "Iranian royal family in exile" },
  "ahmed_n_alnahyan": { country: "UAE", city: "Abu Dhabi", lat: 24.4539, lng: 54.3773, source: "UAE royal family" },

  // Companies & Brands
  "the-jcdecaux-collection": { country: "France", city: "Neuilly-sur-Seine", lat: 48.8846, lng: 2.2693, source: "Advertising company heir" },
  "barrett-jackson-private-collection": { country: "USA", city: "Scottsdale, AZ", lat: 33.4942, lng: -111.9261, source: "Auction company" },
  "borusan-otomotiv-private-collection": { country: "Turkey", city: "Istanbul", lat: 41.0082, lng: 28.9784, source: "BMW distributor Turkey" },
  "ford-performance-collection": { country: "USA", city: "Dearborn, MI", lat: 42.3223, lng: -83.1763, source: "Ford HQ" },
  "honda-collection-hall": { country: "Japan", city: "Motegi", lat: 36.5329, lng: 140.2281, source: "Honda museum" },

  // Geographic Named Collections
  "kiawah-island-collection": { country: "USA", city: "Kiawah Island, SC", lat: 32.6082, lng: -80.0848, source: "South Carolina coast" },
  "monterrey-classic-collection": { country: "Mexico", city: "Monterrey", lat: 25.6866, lng: -100.3161, source: "Mexico" },
  "lititz-ferrari-collection": { country: "USA", city: "Lititz, PA", lat: 40.1576, lng: -76.3072, source: "Pennsylvania" },
  "changhua-ferrari-collection": { country: "Taiwan", city: "Changhua", lat: 24.0734, lng: 120.5134, source: "Taiwan" },
  "rungsted-ferrari-collection": { country: "Denmark", city: "Rungsted", lat: 55.8750, lng: 12.5417, source: "Denmark" },
  "bodyfriend-collection": { country: "South Korea", city: "Seoul", lat: 37.5172, lng: 127.0473, source: "Gangnam-gu" },
  "vasek-polaks-private-collection": { country: "USA", city: "Torrance, CA", lat: 33.8358, lng: -118.3406, source: "Porsche legend" },
  "josh-sweats-car-collection": { country: "USA", city: "Phoenix, AZ", lat: 33.4484, lng: -112.0740, source: "NFL player" },
  "brittany-collection": { country: "France", city: "Brittany", lat: 48.2020, lng: -2.9326, source: "Brittany region" },

  // Museums & Historic Collections
  "auto-world-vintage-museum-collection": { country: "USA", city: "Fulton, MO", lat: 38.8469, lng: -91.9479, source: "Museum" },
  "the-imperial-palace-auto-collection": { country: "USA", city: "Las Vegas, NV", lat: 36.1699, lng: -115.1398, source: "Former casino museum" },
  "petersen-automotive-museum": { country: "USA", city: "Los Angeles, CA", lat: 34.0622, lng: -118.3614, source: "Museum" },
  "porsche-museum": { country: "Germany", city: "Stuttgart", lat: 48.8342, lng: 9.1528, source: "Official Porsche Museum" },
  "ferrari-museum-maranello": { country: "Italy", city: "Maranello", lat: 44.5294, lng: 10.8656, source: "Official Ferrari Museum" },
  "mercedes-benz-museum": { country: "Germany", city: "Stuttgart", lat: 48.7880, lng: 9.2330, source: "Official Mercedes Museum" },
  "bmw-welt": { country: "Germany", city: "Munich", lat: 48.1770, lng: 11.5564, source: "BMW experience center" },

  // F1 Teams & Racing
  "scuderiaferrari": { country: "Italy", city: "Maranello", lat: 44.5294, lng: 10.8656, source: "F1 team" },
  "mclaren": { country: "UK", city: "Woking", lat: 51.3148, lng: -0.5600, source: "F1 team HQ" },
  "aston-martin-f1-team": { country: "UK", city: "Silverstone", lat: 52.0706, lng: -1.0174, source: "F1 team" },
  "red-bull-racing": { country: "UK", city: "Milton Keynes", lat: 52.0406, lng: -0.7594, source: "F1 team" },
  "toyota-gazoo-racing": { country: "Germany", city: "Cologne", lat: 50.9375, lng: 6.9603, source: "Racing team" },
  "nac-racing": { country: "France", city: "Le Mans", lat: 47.9567, lng: 0.2077, source: "Racing team" },

  // Asian Collections
  "the-hiramatsu-collection": { country: "Japan", city: "Tokyo", lat: 35.6762, lng: 139.6503, source: "Japanese collector" },
  "magarigawa-collection": { country: "Japan", city: "Chiba", lat: 35.6073, lng: 140.1063, source: "Magarigawa Club" },
  "yoojean-kim-collection": { country: "South Korea", city: "Seoul", lat: 37.5665, lng: 126.9780, source: "Korean collector" },
  "jimmy-lins-car-collection": { country: "Taiwan", city: "Taipei", lat: 25.0330, lng: 121.5654, source: "Taiwanese actor" },
  "akram-juniors-car-collection": { country: "Pakistan", city: "Lahore", lat: 31.5204, lng: 74.3587, source: "Pakistani collector" },

  // Additional Researched
  "the-sytner-collection": { country: "UK", city: "Leicester", lat: 52.6369, lng: -1.1398, source: "Sytner Group HQ" },
  "lorne-leibels-car-collection": { country: "Canada", city: "Toronto", lat: 43.6532, lng: -79.3832, source: "Canadian Motorsport HOF" },
  "carl-moons-car-collection": { country: "UAE", city: "Dubai", lat: 25.2048, lng: 55.2708, source: "Crypto investor" },
  "nasser-al-thanis-car-collection": { country: "Qatar", city: "Doha", lat: 25.2854, lng: 51.5310, source: "Qatari royal" },
  "thenasseralthanicollection": { country: "Qatar", city: "Doha", lat: 25.2854, lng: 51.5310, source: "Qatari royal" },
  "heppenheim-collection": { country: "Germany", city: "Heppenheim", lat: 49.6417, lng: 8.6361, source: "German city" },
  "the-oldtimer-collection": { country: "Germany", city: "Munich", lat: 48.1351, lng: 11.5820, source: "Classic cars Germany" },
  "the-hickling-collection": { country: "UK", city: "Norfolk", lat: 52.7494, lng: 1.5689, source: "Hickling, Norfolk" },
  "the-lake-house-collection": { country: "USA", city: "Lake Tahoe, CA", lat: 39.0968, lng: -120.0324, source: "Lake house reference" },
  "la-collection-bleu": { country: "France", city: "Nice", lat: 43.7102, lng: 7.2620, source: "Blue collection France" },
  "rosso-barchetta": { country: "Italy", city: "Milan", lat: 45.4642, lng: 9.1900, source: "Italian name" },
  "fbf-collezione": { country: "Italy", city: "Rome", lat: 41.9028, lng: 12.4964, source: "Italian collection" },
  "the-neubauer-family-collection": { country: "Austria", city: "Vienna", lat: 48.2082, lng: 16.3738, source: "German surname" },
  "grossman-racing": { country: "USA", city: "Connecticut", lat: 41.6032, lng: -73.0877, source: "Racing team" },
  "wistar-motors-private-collection": { country: "USA", city: "Philadelphia, PA", lat: 39.9526, lng: -75.1652, source: "Pennsylvania dealer" },
  "the-kristiansen-collection": { country: "Norway", city: "Oslo", lat: 59.9139, lng: 10.7522, source: "Norwegian name" },
  "stevinson-collection": { country: "USA", city: "Denver, CO", lat: 39.7392, lng: -104.9903, source: "Stevinson Automotive" },
  "pga-cars-collection": { country: "USA", city: "Ponte Vedra, FL", lat: 30.2396, lng: -81.3857, source: "PGA Tour HQ area" },

  // European Collections
  "the-krog-collection": { country: "Denmark", city: "Copenhagen", lat: 55.6761, lng: 12.5683, source: "Danish Ferrari collector" },
  "the-ml-collection": { country: "Denmark", city: "North Denmark", lat: 57.0488, lng: 9.9217, source: "Felipe Massa's LaFerrari" },
  "the-versluys-collection": { country: "Belgium", city: "Ostend", lat: 51.2154, lng: 2.9286, source: "Belgian collector" },
  "the-perfetti-collection": { country: "Italy", city: "Milan", lat: 45.4642, lng: 9.1900, source: "Italian collector" },
  "the-amalfitano-collection": { country: "Italy", city: "Naples", lat: 40.8518, lng: 14.2681, source: "Italian collector" },
  "collezione-rosso-monza": { country: "Italy", city: "Monza", lat: 45.5845, lng: 9.2744, source: "Monza area" },

  // Middle East Collections
  "batyr-collection": { country: "Kazakhstan", city: "Almaty", lat: 43.2220, lng: 76.8512, source: "Kazakhstan" },
  "the-samara-collection": { country: "Russia", city: "Samara", lat: 53.1959, lng: 50.1001, source: "Russian collector" },
  "jabrbinhamad": { country: "Bahrain", city: "Manama", lat: 26.2285, lng: 50.5860, source: "Bahrain royal" },
  "the-yadegar-collection": { country: "Iran", city: "Tehran", lat: 35.6892, lng: 51.3890, source: "Iranian collector" },

  // Americas Collections
  "pacific-sports-car-club-collection": { country: "USA", city: "Seattle, WA", lat: 47.6062, lng: -122.3321, source: "Car club" },
  "southern-hypercar-collection": { country: "USA", city: "Atlanta, GA", lat: 33.7490, lng: -84.3880, source: "Southern USA" },
  "atx-black-collection": { country: "USA", city: "Austin, TX", lat: 30.2672, lng: -97.7431, source: "Austin, Texas" },
  "the-don-davis-collection": { country: "USA", city: "Fort Worth, TX", lat: 32.7555, lng: -97.3308, source: "Texas collector" },
  "eduardo-costabals-private-collection": { country: "Chile", city: "Santiago", lat: -33.4489, lng: -70.6693, source: "Chilean collector" },
  "santa-laura-collection": { country: "Chile", city: "Iquique", lat: -20.2141, lng: -70.1524, source: "Chile" },

  // NEW - From research agents batch 1
  "scuderia-gg": { country: "Italy", city: "Milan", lat: 45.4642, lng: 9.1900, source: "ECR page" },
  "the-shields-collection": { country: "UK", city: "Belfast", lat: 54.5973, lng: -5.9301, source: "Northern Ireland" },
  "the-cohen-collection": { country: "USA", city: "Avon, CT", lat: 41.8098, lng: -72.8301, source: "ECR page" },
  "the-bluhm-collection": { country: "Germany", city: "Cologne", lat: 50.9375, lng: 6.9603, source: "Eckhard Bluhm Ferrari collector" },
  "the-weng-collection": { country: "Taiwan", city: "Taoyuan", lat: 24.9936, lng: 121.3010, source: "ECR page" },
  "the-pray-collection": { country: "USA", city: "Bedford, NY", lat: 41.2048, lng: -73.6440, source: "ECR page" },
  "grant-bakers-car-collection": { country: "New Zealand", city: "Auckland", lat: -36.8509, lng: 174.7645, source: "ECR page" },
  "the-piazza-collection": { country: "USA", city: "Bryn Mawr, PA", lat: 40.0218, lng: -75.3163, source: "Former Algar Ferrari dealership" },
  "the-speedy-gonzales-collection": { country: "UAE", city: "Dubai", lat: 25.2048, lng: 55.2708, source: "ECR page" },
  "dct-racing": { country: "South Korea", city: "Yongin-si", lat: 37.2411, lng: 127.1776, source: "Korean racing team" },
  "talcos-garage": { country: "USA", city: "Boston, MA", lat: 42.3601, lng: -71.0589, source: "ECR page" },

  // NEW - From research agents batch 2
  "the-sidhom-collection": { country: "USA", city: "Glen Cove, NY", lat: 40.8623, lng: -73.6315, source: "ECR page" },
  "jas_aulakh": { country: "USA", city: "Newport Beach, CA", lat: 33.6189, lng: -117.9289, source: "ECR page" },
  "oceanking_seven": { country: "Singapore", city: "Singapore", lat: 1.3021, lng: 103.9056, source: "ECR page Albert Oon" },
  "nomorelots": { country: "Singapore", city: "Singapore", lat: 1.3050, lng: 103.8200, source: "ECR page" },
  "jc-para-collection": { country: "USA", city: "Westhampton, NY", lat: 40.8237, lng: -72.6662, source: "ECR page" },
  "challengetheroad": { country: "UK", city: "West Sussex", lat: 50.9200, lng: -0.4500, source: "ECR page Richard Groves" },
  "hubbard-collection": { country: "USA", city: "Scottsdale, AZ", lat: 33.4942, lng: -111.9261, source: "ECR page" },
  "turbo832": { country: "South Korea", city: "Seoul", lat: 37.5326, lng: 126.9900, source: "ECR page Yongsan-gu" },
  "car777watches": { country: "UAE", city: "Dubai", lat: 25.2048, lng: 55.2708, source: "Greek-Turkish Bugatti collector" },
  "the-carrera-collection": { country: "Switzerland", city: "Zurich", lat: 47.3769, lng: 8.5417, source: "Swiss collection" },
  "chemicalmethod": { country: "Switzerland", city: "Zurich", lat: 47.3769, lng: 8.5417, source: "Relocated from Los Angeles" },
  "max-engines": { country: "Czechia", city: "Prague", lat: 50.0755, lng: 14.4378, source: "Czech Republic" },
  "luckyssupercars": { country: "UK", city: "Exeter", lat: 50.7184, lng: -3.5339, source: "ECR page" },

  // Additional verified from batch searches
  "the-hamilton-collection": { country: "USA", city: "Naperville, IL", lat: 41.7508, lng: -88.1535, source: "Steve Hamilton YouTube" },
  "h0": { country: "UK", city: "London", lat: 51.5074, lng: -0.1278, source: "ECR page" },
  "mr-sup": { country: "USA", city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437, source: "Los Angeles county" },
  "the-cesario-collection": { country: "USA", city: "San Francisco, CA", lat: 37.7749, lng: -122.4194, source: "ECR page" },
  "the-sundial-collection": { country: "USA", city: "Old Westbury, NY", lat: 40.7884, lng: -73.5982, source: "ECR page" },
  "diko-sulahians-car-collection": { country: "USA", city: "Newport Beach, CA", lat: 33.6189, lng: -117.9289, source: "ECR page" },
  "license-to-thrill-collection": { country: "USA", city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437, source: "ECR page" },
  "hypercar-circuit-collection": { country: "Japan", city: "Tokyo", lat: 35.6762, lng: 139.6503, source: "Mr Miura Akinari" },
  "warsaw-supercars-collection": { country: "Poland", city: "Warsaw", lat: 52.2297, lng: 21.0122, source: "McLaren focused" },
  "the-petfred-collection": { country: "USA", city: "Miami, FL", lat: 25.7617, lng: -80.1918, source: "ECR page" },
  "artscollection": { country: "Austria", city: "Vienna", lat: 48.2082, lng: 16.3738, source: "ECR page" },
  "rfx_collection": { country: "Germany", city: "Herford", lat: 52.1145, lng: 8.6733, source: "ECR page" },
  "swizzcars": { country: "Switzerland", city: "Neuchâtel", lat: 46.9920, lng: 6.9311, source: "Ferrari collection" },
  "the-gt1-collection": { country: "Germany", city: "Stuttgart", lat: 48.7758, lng: 9.1829, source: "Germany/Switzerland" },
  "the-duyver-collection": { country: "Switzerland", city: "Geneva", lat: 46.2044, lng: 6.1432, source: "Swiss-Belgian entrepreneur" },
  "ortega-car-collection": { country: "Switzerland", city: "Schwyz", lat: 47.0207, lng: 8.6530, source: "Porsche race cars" },
  "south-carolina-ferrari-collection": { country: "USA", city: "North, SC", lat: 33.6124, lng: -81.0979, source: "ECR page" },
  "the-tailored-for-speed-collection": { country: "Switzerland", city: "Zurich", lat: 47.3769, lng: 8.5417, source: "Iron Lynx/Iron Dames" },
  "dutch-ferrari-collector": { country: "Netherlands", city: "Amsterdam", lat: 52.3676, lng: 4.9041, source: "ECR page Big 5" },
  "texmex-ferrari-collection": { country: "USA", city: "Austin, TX", lat: 30.2672, lng: -97.7431, source: "Austin and Mexico City" },
  "ferrari-collector-australia": { country: "Australia", city: "Melbourne", lat: -37.8136, lng: 144.9631, source: "ECR page" },
  "k-k-collection": { country: "Taiwan", city: "Taipei", lat: 25.0330, lng: 121.5654, source: "Taiwan and Switzerland" },
  "collezione-ez": { country: "Italy", city: "Venice", lat: 45.4408, lng: 12.3155, source: "North-eastern Italy" },
  "collezioneveneto": { country: "Italy", city: "Venice", lat: 45.4408, lng: 12.3155, source: "Veneto region" },

  // NEW BATCH - Celebrity collections research
  "nicolas-cages-car-collection": { country: "USA", city: "Las Vegas, NV", lat: 36.1699, lng: -115.1398, source: "Las Vegas mansion" },
  "tyler-the-creators-car-collection": { country: "USA", city: "Los Angeles, CA", lat: 33.9942, lng: -118.3754, source: "Ladera Heights area" },
  "max-verstappens-car-collection": { country: "Monaco", city: "Fontvieille", lat: 43.7269, lng: 7.4177, source: "F1 champion residence" },
  "david-lettermans-car-collection": { country: "USA", city: "Danbury, CT", lat: 41.3717, lng: -73.4820, source: "37,000 sq ft warehouse" },
  "sebastian-vettels-car-collection": { country: "Switzerland", city: "Ellighausen", lat: 47.6139, lng: 9.1356, source: "Neumuhli farmhouse" },
  "drakes-car-collection": { country: "Canada", city: "Toronto", lat: 43.7330, lng: -79.3680, source: "The Embassy mansion" },
  "mat-armstrongs-car-collection": { country: "UK", city: "Ibstock", lat: 52.6876, lng: -1.3976, source: "Leicestershire workshop" },
  "clark-gables-car-collection": { country: "USA", city: "Encino, CA", lat: 34.1517, lng: -118.5214, source: "Historic ranch" },
  "ed-bolians-car-collection": { country: "USA", city: "Alpharetta, GA", lat: 34.0754, lng: -84.2941, source: "VINwiki founder" },
  "mansour-ojjehs-car-collection": { country: "Switzerland", city: "Collonge-Bellerive", lat: 46.2416, lng: 6.1962, source: "McLaren TAG chairman" },

  // NEW BATCH - Instagram collectors research
  "turbophile888": { country: "USA", city: "Greenwich, CT", lat: 41.0262, lng: -73.6282, source: "Miller Motorcars delivery" },
  "rags_2richz": { country: "USA", city: "Miami, FL", lat: 25.7617, lng: -80.1918, source: "Steven Weinstock Porsche collector" },
  "kenki_mitsui": { country: "Japan", city: "Tokyo", lat: 35.6762, lng: 139.6503, source: "CEO Eiff, Ikebukuro" },
  "haeundae__pikachu": { country: "South Korea", city: "Busan", lat: 35.1631, lng: 129.1636, source: "Haeundae district" },
  "markwang_cargarage": { country: "USA", city: "Seattle, WA", lat: 47.6062, lng: -122.3321, source: "Instagram posts" },
  "moto_carandracing": { country: "Japan", city: "Tokyo", lat: 35.6762, lng: 139.6503, source: "ECR page Tokyo/Monaco" },

  // NEW BATCH - Location-named collections research
  "hawaiian-hypercar-collection": { country: "USA", city: "Honolulu, HI", lat: 21.3069, lng: -157.8583, source: "Hawaii collection" },
  "solothurn-collection": { country: "Switzerland", city: "Solothurn", lat: 47.2088, lng: 7.5323, source: "Lucien Handschin" },
  "the-curitiba-collection": { country: "Brazil", city: "Curitiba", lat: -25.4290, lng: -49.2671, source: "Largest Brazil supercar collection" },
  "my-aspen-collection": { country: "USA", city: "Aspen, CO", lat: 39.1911, lng: -106.8175, source: "Jorge Fuentes" },
  "villa-del-mar-collection": { country: "USA", city: "Miami, FL", lat: 25.7617, lng: -80.1918, source: "Not Chile - Miami based" },
  "second-city-exotics": { country: "USA", city: "Barrington, IL", lat: 42.1542, lng: -88.1365, source: "Chicago area" },
  "lakeside-collection": { country: "Switzerland", city: "Zug", lat: 47.1724, lng: 8.5177, source: "Swiss lakeside" },
  "arto-team-thailand": { country: "Thailand", city: "Bangkok", lat: 13.7563, lng: 100.5018, source: "Toyota Gazoo Racing Thailand president" },
  "ahg-mex-collection": { country: "Mexico", city: "Mexico City", lat: 19.4326, lng: -99.1332, source: "Classic supercars" },
  "the-finn-collection": { country: "USA", city: "Danbury, CT", lat: 41.3948, lng: -73.4540, source: "Joel E. Finn memorial" },
  "legado-collection": { country: "Mexico", city: "Mexico City", lat: 19.4326, lng: -99.1332, source: "Split with LA" },
  "iraqi-rolls-royce-collection": { country: "UAE", city: "Dubai", lat: 25.2048, lng: 55.2708, source: "Stored in Dubai/UK" },
  "fondation-renaud": { country: "Switzerland", city: "Cortaillod", lat: 46.9442, lng: 6.8439, source: "Charles Renaud museum" },

  // NEW BATCH - Named family collections research
  "the-weinberger-collection": { country: "USA", city: "Naperville, IL", lat: 41.7508, lng: -88.1535, source: "John F. Weinberger" },
  "the-wegman-collection": { country: "USA", city: "Rochester, NY", lat: 43.1566, lng: -77.6088, source: "Danny Wegman Wegmans CEO" },
  "the-hsu-collection": { country: "USA", city: "New York, NY", lat: 40.7128, lng: -74.0060, source: "Aaron Hsu 250 GTO owner" },
  "the-schaevitz-collection": { country: "USA", city: "Bedford Corners, NY", lat: 41.2101, lng: -73.6929, source: "Gary Schaevitz McLaren F1s" },
  "the-kaminskey-collection": { country: "USA", city: "Long Island, NY", lat: 40.7891, lng: -73.1350, source: "Brian Kaminskey Ferrari Challenge" },
  "the-haddawy-collection": { country: "USA", city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437, source: "Mark Haddawy Resurrection Vintage" },
  "the-shraga-collection": { country: "Israel", city: "Tel Aviv", lat: 32.0853, lng: 34.7818, source: "Elad Shraga OSCA collector" },
  "jorg-kintzels-car-collection": { country: "Germany", city: "Munich", lat: 48.1351, lng: 11.5820, source: "Valuniq AG board" },
  "pierre-noblets-car-collection": { country: "France", city: "Roubaix", lat: 50.6942, lng: 3.1746, source: "Racing driver 1921-2014" },

  // NEW BATCH - Racing/motorsport collections research
  "bykolles-collection": { country: "Germany", city: "Greding", lat: 49.047, lng: 11.357, source: "Racing team HQ" },
  "alegra-motorsports-collection": { country: "USA", city: "Tampa, FL", lat: 27.964, lng: -82.453, source: "8408 Benjamin Road" },
  "peregrine-motorsports-private-collection": { country: "USA", city: "Bryn Mawr, PA", lat: 40.020, lng: -75.315, source: "ECR page" },
  "jo-sifferts-car-collection": { country: "Switzerland", city: "Fribourg", lat: 46.802, lng: 7.151, source: "Swiss F1 driver memorial" },
  "toro-racing": { country: "China", city: "Guiyang", lat: 26.647, lng: 106.630, source: "Eric Zang Kan" },
  "mecum-private-collection": { country: "USA", city: "Lake Geneva, WI", lat: 42.592, lng: -88.433, source: "Dana Mecum personal" },
  "q-motorsports": { country: "Germany", city: "Trebur", lat: 49.927, lng: 8.406, source: "Sven Quandt Audi team" },
  "rauh-vipers-collection": { country: "USA", city: "Arp, TX", lat: 32.222, lng: -95.053, source: "World largest Viper collection 80+" },
  "contempo-concept-private-collection": { country: "Hong Kong", city: "Kowloon Tong", lat: 22.333, lng: 114.180, source: "Kevin Tse JDM collection" },
  "tomini-classics-private-collection": { country: "UAE", city: "Dubai", lat: 25.111, lng: 55.195, source: "First postwar classic in Middle East" },
  "palmer-motorama": { country: "Australia", city: "Lowood", lat: -27.467, lng: 152.583, source: "Clive Palmer 1000+ car museum" },

  // NEW BATCH - Asian collectors research
  "sk": { country: "Switzerland", city: "Stans", lat: 46.9572, lng: 8.3660, source: "German entrepreneur Gemballa owner" },
  "hotcave-by-eh0601": { country: "Belgium", city: "Brussels", lat: 50.8505, lng: 4.3488, source: "Emmanuel Belgian entrepreneur" },
  "7777j8888": { country: "South Korea", city: "Seoul", lat: 37.5172, lng: 127.0473, source: "Gangnam-gu" },
  "kamonegi_aniki": { country: "Japan", city: "Kyoto", lat: 35.0211, lng: 135.7539, source: "ECR page" },
  "93_cf": { country: "UK", city: "London", lat: 51.5099, lng: -0.1181, source: "Ferrari Challenge racer" },
  "alex-chois-car-collection": { country: "USA", city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437, source: "YouTuber Korean-American" },
  "jacky-liu-collection": { country: "China", city: "Shenzhen", lat: 22.5429, lng: 114.0630, source: "Shanghai Bohao shareholder" },
  "hiepletran": { country: "USA", city: "Newport Beach, CA", lat: 33.6283, lng: -117.9279, source: "Holy Trinity Cars owner" },
  "dhiaa070": { country: "Saudi Arabia", city: "Riyadh", lat: 24.7743, lng: 46.7386, source: "Valkyrie owner track user" },
  "jchwa": { country: "USA", city: "Irvine, CA", lat: 33.6695, lng: -117.8231, source: "Justin Choi tech entrepreneur" },
  "kwaks-collection": { country: "South Korea", city: "Seoul", lat: 37.5334, lng: 126.9791, source: "HANMI Semiconductor CEO" },
  "myperformantis": { country: "Lebanon", city: "Beirut", lat: 33.8933, lng: 35.5016, source: "Eliccio Kheir Allah" },

  // NEW BATCH - European named collections research
  "the-strnad-collection": { country: "Czechia", city: "Kopřivnice", lat: 49.5993, lng: 18.1448, source: "Jaroslav Strnad TATRA museum" },
  "the-sufliarsky-collection": { country: "Slovakia", city: "Lučenec", lat: 48.3327, lng: 19.6673, source: "Marian Sufliarsky Ferrari collector" },
  "the-wettach-collection": { country: "USA", city: "Atlanta, GA", lat: 33.7490, lng: -84.3880, source: "Ed Wettach Ferrari of Atlanta" },
  "the-soleymani-collection": { country: "USA", city: "Saint Johns, FL", lat: 30.0812, lng: -81.3975, source: "Dr Saman Soleymani Pagani owner" },
  "the-schneider-collection": { country: "USA", city: "Dallas, TX", lat: 32.7767, lng: -96.7970, source: "Haydn Schneider Alani Nu founder" },
  "collection-charbonneaux": { country: "France", city: "Reims", lat: 49.2583, lng: 4.0317, source: "Philippe Charbonneaux museum dispersed" },
  "the-dieteren-collection": { country: "Belgium", city: "Brussels", lat: 50.8505, lng: 4.3488, source: "D'Ieteren Gallery 250+ cars" },
  "the-boch-collection": { country: "USA", city: "Norwood, MA", lat: 42.1945, lng: -71.1995, source: "Ernie Boch Jr Ferrari of New England" },
  "the-halusa-collection": { country: "Austria", city: "Vienna", lat: 48.2082, lng: 16.3738, source: "Martin Halusa Apax F1 collector" },

  // NEW BATCH - Middle East collectors research
  "principekarim": { country: "Dominican Republic", city: "Santo Domingo", lat: 18.4861, lng: -69.9312, source: "El Principe not royal" },
  "abbas_saj": { country: "UAE", city: "Dubai", lat: 25.2048, lng: 55.2708, source: "Abbas Sajwani DAMAC heir" },
  "the-gurdev-collection": { country: "UK", city: "London", lat: 51.5074, lng: -0.1278, source: "Gurdev Singh Bugatti collection" },
  "batyr-collection": { country: "Kazakhstan", city: "Astana", lat: 51.1605, lng: 71.4704, source: "Madiyar Batyr" },

  // NEW BATCH - US collections research
  "the-comer-collection": { country: "USA", city: "Milwaukee, WI", lat: 43.0389, lng: -87.9065, source: "Colin Comer classic auto" },
  "the-suydam-collection": { country: "USA", city: "Seattle, WA", lat: 47.6062, lng: -122.3321, source: "Kevin Suydam Corvettes" },
  "the-off-brothers-collection": { country: "USA", city: "Richland, MI", lat: 42.3736, lng: -85.4561, source: "Ice rink collection" },
  "the-gentlemans-garage": { country: "USA", city: "Houston, TX", lat: 29.7604, lng: -95.3698, source: "Louis Flory Ferrari Challenge" },
  "the-bortz-auto-collection": { country: "USA", city: "Highland Park, IL", lat: 42.1817, lng: -87.8003, source: "Joe Bortz concept cars" },
  "the-terence-e-adderley-collection": { country: "USA", city: "Bloomfield Hills, MI", lat: 42.5837, lng: -83.2455, source: "Kelly Services president 150 cars" },
  "the-taylor-collection": { country: "USA", city: "Gloversville, NY", lat: 43.0526, lng: -74.3437, source: "Jim Taylor 130+ cars auctioned" },
  "steven-harris-collection": { country: "USA", city: "Rancho Mirage, CA", lat: 33.7397, lng: -116.4131, source: "Porsche architect collector" },
  "the-mittler-collection": { country: "USA", city: "Three Rivers, MI", lat: 41.9439, lng: -85.6325, source: "Tom Mittler boats & cars" },
  "the-ogliastro-collection": { country: "France", city: "Monflanquin", lat: 44.5309, lng: 0.7662, source: "Herve Ogliastro Vuitton family" },
  "the-bailey-collection": { country: "UK", city: "Hambleton", lat: 53.7862, lng: -1.1464, source: "Paul Bailey Holy Trinity first UK" },
  "mcgrath-collection": { country: "UK", city: "Kimpton", lat: 51.8833, lng: -0.2967, source: "Bill McGrath Maserati specialist" },

  // NEW BATCH - Instagram handles research
  "jzaibs-garage": { country: "USA", city: "Pompano Beach, FL", lat: 26.2379, lng: -80.1248, source: "Jahanzaib Majid Florida" },
  "jayvj": { country: "UK", city: "Barnet", lat: 51.6444, lng: -0.1997, source: "440K followers Pagani owner" },
  "0008-collection": { country: "India", city: "Mumbai", lat: 19.0760, lng: 72.8777, source: "Dinesh Thakkar Angel One CEO" },
  "rammjaeger": { country: "USA", city: "Roswell, GA", lat: 34.0232, lng: -84.3616, source: "John Gibson" },
  "chickendiarrhea": { country: "Japan", city: "Ebisu", lat: 37.6422, lng: 140.4317, source: "Formula Drift Japan" },

  // NEW BATCH - European collections batch 2
  "the-porsport-collection": { country: "USA", city: "Islip, NY", lat: 40.7298, lng: -73.2104, source: "Long Island" },
  "the-aec-collection": { country: "Canada", city: "Aurora, ON", lat: 44.0065, lng: -79.4504, source: "Automobile Museo" },
  "ak-prestige-private-collection": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522, source: "Ak Prestige Ferrari" },
  "hans-georg-plaut": { country: "Germany", city: "Hannover", lat: 52.3705, lng: 9.7332, source: "ECR page" },
  "william-loughran-private-collection": { country: "UK", city: "Preston", lat: 53.7628, lng: -2.7045, source: "50+ years dealer" },
  "m-ferrao-collection": { country: "Portugal", city: "Sintra", lat: 38.8010, lng: -9.3783, source: "ECR page" },
  "pce-collection": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522, source: "ECR page" },
  "turbo-troy": { country: "Canada", city: "West Vancouver, BC", lat: 49.3667, lng: -123.1665, source: "Bugatti Veyron owner" },
  "1999-collection": { country: "Taiwan", city: "Taipei", lat: 25.0478, lng: 121.5319, source: "ECR page" },
  "the-shadow-collection": { country: "USA", city: "Key West, FL", lat: 24.5552, lng: -81.7816, source: "James Bartel Shadow racing" },
  "bluscorpio-collection": { country: "Taiwan", city: "Taipei", lat: 25.0478, lng: 121.5319, source: "TransAsia Airways chairman" },
  "purist-collector": { country: "Poland", city: "Mosina", lat: 52.2454, lng: 16.8471, source: "Near Poznan" },
  "budd-and-lauries-garage": { country: "USA", city: "Scottsdale, AZ", lat: 33.5092, lng: -111.8990, source: "28 American classics" },
  "nico2015": { country: "USA", city: "Langhorne, PA", lat: 40.1746, lng: -74.9227, source: "Mercedes specialist BaT" },
  "the-summer-collection": { country: "China", city: "Beijing", lat: 39.9075, lng: 116.3972, source: "Yi Bin" },

  // NEW BATCH - Numbered/coded collections
  "mr-6841-collection": { country: "Malaysia", city: "Ipoh", lat: 4.5975, lng: 101.0901, source: "Carrera GT CLK DTM owner" },
  "car-3219-collection": { country: "Japan", city: "Ageo", lat: 35.9775, lng: 139.5932, source: "Saitama dealership Centenario" },
  "mr-w16": { country: "India", city: "Hyderabad", lat: 17.3850, lng: 78.4867, source: "Dissolved 2012 legal issues" },
  "p24": { country: "UK", city: "Richmond", lat: 51.4613, lng: -0.3037, source: "Parhham Donyai LA Muscle" },
  "skier33": { country: "UK", city: "London", lat: 51.5074, lng: -0.1278, source: "Alexander West racing driver" },
  "72stagpower": { country: "Germany", city: "Wolfenbüttel", lat: 52.1622, lng: 10.5369, source: "Jägermeister Racing heritage" },
  "buckblu": { country: "USA", city: "Atherton, CA", lat: 37.4613, lng: -122.1975, source: "Silicon Valley Ferrari collector" },
  "zzzz-collection": { country: "China", city: "Shenzhen", lat: 22.5431, lng: 114.0579, source: "Pagani specialist" },
  "fxalexg": { country: "USA", city: "Miami, FL", lat: 25.7617, lng: -80.1918, source: "Forex trader Bugatti owner" },
  "redzon_ssn-collection": { country: "South Korea", city: "Seoul", lat: 37.5172, lng: 127.0473, source: "Gangnam-gu" },
  "specmysenna": { country: "USA", city: "San Francisco, CA", lat: 37.7749, lng: -122.4194, source: "McLaren Senna GTR owner deceased 2025" },
  "toms-garage": { country: "USA", city: "Cave Creek, AZ", lat: 33.8317, lng: -111.9506, source: "Carrera GT Ford GT" },
  "zakttroy": { country: "UK", city: "London", lat: 51.5074, lng: -0.1278, source: "Modern supercar collection" },

  // NEW BATCH - French/Latin collections
  "francois-picards-car-collection": { country: "France", city: "Nice", lat: 43.7102, lng: 7.2620, source: "Racing driver 1921-1996" },
  "fernand-tavanos-car-collection": { country: "France", city: "Le Mans", lat: 47.9956, lng: 0.1909, source: "Ferrari 250 GTO privateer" },
  "jean-sages-car-collection": { country: "France", city: "Annecy", lat: 45.8992, lng: 6.1294, source: "Renault F1 director" },
  "the-beaumartin-collection": { country: "France", city: "Bordeaux", lat: 44.8378, lng: -0.5792, source: "Xavier Beaumartin winemaker" },
  "the-bensoussan-collection": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522, source: "Edgar Bensoussan WWII pilot" },
  "the-quadrifoglio-collection": { country: "USA", city: "Gowanda, NY", lat: 42.4617, lng: -78.9356, source: "Alfa Romeo racing" },
  "the-zent-collection": { country: "Japan", city: "Nagoya", lat: 35.1815, lng: 136.9066, source: "Yoshio Tsuzuki 31 hypercars" },
  "ghibli-collection": { country: "Japan", city: "Nagoya", lat: 35.1815, lng: 136.9066, source: "Blu Ghibli Cup Ferraris" },
  "lafestada-collection": { country: "South Korea", city: "Seoul", lat: 37.5172, lng: 127.0473, source: "Lamborghini Sian owner" },
  "efese-collection": { country: "Chile", city: "Santiago", lat: -33.4489, lng: -70.6693, source: "Ferrari 812 Competizione" },
  "the-ruben-collection": { country: "UK", city: "Windsor", lat: 51.4816, lng: -0.6044, source: "Porsche focused" },
  "the-aco-collection": { country: "France", city: "Le Mans", lat: 47.9956, lng: 0.1909, source: "24 Hours organizer museum" },
  "j-a-campos-costa": { country: "Portugal", city: "Vila Nova de Famalicão", lat: 41.4090, lng: -8.5200, source: "Maserati Mercedes collector" },

  // NEW BATCH - Feb 6 2026 Research Agents (Haiku)
  // Famous collections
  "johnny-hallydays-car-collection": { country: "France", city: "Marnes-la-Coquette", lat: 48.8331, lng: 2.1623, source: "Villa La Savannah" },
  "zak-browns-car-collection": { country: "UK", city: "Wakefield", lat: 53.6833, lng: -1.4977, source: "United Autosports" },
  "reggie-jacksons-car-collection": { country: "USA", city: "Seaside, CA", lat: 36.6111, lng: -121.8516, source: "16000 sq ft Reggie's Garage" },
  "jody-scheckters-car-collection": { country: "Monaco", city: "Monaco", lat: 43.7395, lng: 7.4257, source: "1979 F1 champion - sold at auction 2024" },
  "lawrence-strolls-car-collection": { country: "Canada", city: "Mont-Tremblant, QC", lat: 46.2127, lng: -74.5844, source: "$140M 27+ car collection" },
  "the-simeone-foundation": { country: "USA", city: "Philadelphia, PA", lat: 39.9109, lng: -75.2266, source: "6825 Norwitch Drive museum" },
  "tiriac-collection": { country: "Romania", city: "Otopeni", lat: 44.5672, lng: 26.0835, source: "Ion Tiriac 320+ cars 8600 sqm" },
  "collezione-umberto-panini": { country: "Italy", city: "Modena", lat: 44.6301, lng: 10.8086, source: "Largest Maserati collection" },
  "the-schlumpf-collection": { country: "France", city: "Mulhouse", lat: 47.7500, lng: 7.3333, source: "Cité de l'Automobile 450+ cars" },
  "the-audrain-collection": { country: "USA", city: "Newport, RI", lat: 41.4821, lng: -71.3082, source: "222 Bellevue Ave museum" },

  // Billionaire collections
  "brunei-royal-family-collection": { country: "Brunei", city: "Bandar Seri Begawan", lat: 4.9403, lng: 114.9481, source: "Sultan - 7000 cars world's largest" },
  "gildo-pastor": { country: "Monaco", city: "Monaco", lat: 43.7333, lng: 7.4167, source: "Venturi founder" },
  "mateschitz-collection": { country: "Austria", city: "Salzburg", lat: 47.7994, lng: 13.0440, source: "Red Bull founder Hangar 7" },
  "the-macneil-collection": { country: "USA", city: "Bolingbrook, IL", lat: 41.6986, lng: -88.0684, source: "WeatherTech founder 250 GTO" },
  "the-heinecke-collection": { country: "Thailand", city: "Bangkok", lat: 13.7513, lng: 100.4897, source: "Minor Hotels founder" },
  "frits-van-eerd-ves-collection": { country: "Netherlands", city: "Veghel", lat: 51.6167, lng: 5.5486, source: "Jumbo supermarkets" },
  "the-lingenfelter-collection": { country: "USA", city: "Brighton, MI", lat: 42.5295, lng: -83.7802, source: "7819 Lochlin Drive 200+ cars" },
  "the-bamford-family-collection": { country: "UK", city: "Oakamoor", lat: 53.0005, lng: -1.9229, source: "JCB family 33 cars" },
  "house-of-bijan": { country: "USA", city: "Beverly Hills, CA", lat: 34.0736, lng: -118.4004, source: "Rodeo Drive 23 cars" },

  // F1/Racing drivers
  "carlos-sainz-jrs-car-collection": { country: "Spain", city: "Madrid", lat: 40.4168, lng: -3.7038, source: "F1 driver" },
  "lando-norris-car-collection": { country: "Monaco", city: "Monaco", lat: 43.7383, lng: 7.4245, source: "F1 driver" },
  "lewis-hamilton-car-collection": { country: "USA", city: "Beverly Hills, CA", lat: 34.0736, lng: -118.4004, source: "F1 champion - sold collection" },
  "mika-hakkinen-car-collection": { country: "Monaco", city: "Monaco", lat: 43.7383, lng: 7.4245, source: "F1 champion $6M collection" },
  "gordon-murrays-car-collection": { country: "UK", city: "Windlesham, Surrey", lat: 51.3715, lng: -0.6338, source: "GMA Highams Park HQ" },
  "toto-wolffs-car-collection": { country: "Monaco", city: "Monaco", lat: 43.7383, lng: 7.4245, source: "Mercedes F1 boss" },
  "adrian-neweys-car-collection": { country: "UK", city: "Milton Keynes", lat: 52.0406, lng: -0.7594, source: "Red Bull designer" },
  "bernie-ecclestones-car-collection": { country: "UK", city: "Biggin Hill", lat: 51.3205, lng: 0.0332, source: "Sold to Mark Mateschitz 2025" },
  "hubert-haupts-car-collection": { country: "Germany", city: "Munich", lat: 48.1374, lng: 11.5755, source: "DTM driver" },

  // Middle East collections
  "faz3": { country: "UAE", city: "Dubai", lat: 25.2048, lng: 55.2708, source: "Sheikh Hamdan Crown Prince" },
  "mohammed_km1": { country: "UAE", city: "Dubai", lat: 25.2048, lng: 55.2708, source: "Mohammed Ben Sulayem" },
  "qa_jbm": { country: "Qatar", city: "Doha", lat: 25.2854, lng: 51.5310, source: "Qatar collector" },
  "khks-car-collection": { country: "Qatar", city: "Doha", lat: 25.2854, lng: 51.5310, source: "Sheikh Khalifa bin Hamad Al Thani" },
  "the-al-qamra-collection": { country: "Qatar", city: "Doha", lat: 25.2854, lng: 51.5310, source: "Al Difaaf Street" },
  "the-hussein-family-collection": { country: "Iraq", city: "Erbil", lat: 36.1856, lng: 44.0110, source: "Saddam/Uday Hussein historical" },
  "singapore-zonda-collection": { country: "Singapore", city: "Singapore", lat: 1.3521, lng: 103.8198, source: "Tommie Goh Tanglin" },
};

// Pattern-based locations (from original script)
const locationPatterns: Record<string, { country: string; city: string; lat: number; lng: number }> = {
  // Middle East
  "qatar": { country: "Qatar", city: "Doha", lat: 25.2854, lng: 51.5310 },
  "morocco": { country: "Morocco", city: "Casablanca", lat: 33.5731, lng: -7.5898 },
  "oman": { country: "Oman", city: "Muscat", lat: 23.5880, lng: 58.3829 },
  "dubai": { country: "UAE", city: "Dubai", lat: 25.2048, lng: 55.2708 },
  "saudi": { country: "Saudi Arabia", city: "Riyadh", lat: 24.7136, lng: 46.6753 },
  "kuwait": { country: "Kuwait", city: "Kuwait City", lat: 29.3759, lng: 47.9774 },
  "beirut": { country: "Lebanon", city: "Beirut", lat: 33.8938, lng: 35.5018 },

  // Europe
  "monaco": { country: "Monaco", city: "Monaco", lat: 43.7384, lng: 7.4246 },
  "monegasque": { country: "Monaco", city: "Monaco", lat: 43.7384, lng: 7.4246 },
  "paris": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522 },
  "parisian": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522 },
  "french": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522 },
  "munich": { country: "Germany", city: "Munich", lat: 48.1351, lng: 11.5820 },
  "stuttgart": { country: "Germany", city: "Stuttgart", lat: 48.7758, lng: 9.1829 },
  "german": { country: "Germany", city: "Munich", lat: 48.1351, lng: 11.5820 },
  "milan": { country: "Italy", city: "Milan", lat: 45.4642, lng: 9.1900 },
  "maranello": { country: "Italy", city: "Maranello", lat: 44.5294, lng: 10.8656 },
  "monza": { country: "Italy", city: "Monza", lat: 45.5845, lng: 9.2744 },
  "italian": { country: "Italy", city: "Milan", lat: 45.4642, lng: 9.1900 },
  "warsaw": { country: "Poland", city: "Warsaw", lat: 52.2297, lng: 21.0122 },
  "cracow": { country: "Poland", city: "Krakow", lat: 50.0647, lng: 19.9450 },
  "wroclaw": { country: "Poland", city: "Wroclaw", lat: 51.1079, lng: 17.0385 },
  "london": { country: "UK", city: "London", lat: 51.5074, lng: -0.1278 },
  "british": { country: "UK", city: "London", lat: 51.5074, lng: -0.1278 },
  "swiss": { country: "Switzerland", city: "Zurich", lat: 47.3769, lng: 8.5417 },
  "geneva": { country: "Switzerland", city: "Geneva", lat: 46.2044, lng: 6.1432 },
  "dutch": { country: "Netherlands", city: "Amsterdam", lat: 52.3676, lng: 4.9041 },
  "antwerp": { country: "Belgium", city: "Antwerp", lat: 51.2194, lng: 4.4025 },
  "marbella": { country: "Spain", city: "Marbella", lat: 36.5101, lng: -4.8824 },
  "gibraltar": { country: "Gibraltar", city: "Gibraltar", lat: 36.1408, lng: -5.3536 },
  "istanbul": { country: "Turkey", city: "Istanbul", lat: 41.0082, lng: 28.9784 },
  "turkey": { country: "Turkey", city: "Istanbul", lat: 41.0082, lng: 28.9784 },

  // Americas
  "texas": { country: "USA", city: "Houston", lat: 29.7604, lng: -95.3698 },
  "florida": { country: "USA", city: "Miami", lat: 25.7617, lng: -80.1918 },
  "california": { country: "USA", city: "Los Angeles", lat: 34.0522, lng: -118.2437 },
  "thermal": { country: "USA", city: "Thermal, CA", lat: 33.6403, lng: -116.1392 },
  "toronto": { country: "Canada", city: "Toronto", lat: 43.6532, lng: -79.3832 },
  "bayarea": { country: "USA", city: "San Francisco", lat: 37.7749, lng: -122.4194 },

  // Asia Pacific
  "tokyo": { country: "Japan", city: "Tokyo", lat: 35.6762, lng: 139.6503 },
  "japanese": { country: "Japan", city: "Tokyo", lat: 35.6762, lng: 139.6503 },
  "australia": { country: "Australia", city: "Sydney", lat: -33.8688, lng: 151.2093 },
  "gosford": { country: "Australia", city: "Gosford", lat: -33.4245, lng: 151.3418 },

  // Brands
  "ferrari": { country: "Italy", city: "Maranello", lat: 44.5294, lng: 10.8656 },
  "lamborghini": { country: "Italy", city: "Bologna", lat: 44.4949, lng: 11.3426 },
  "porsche": { country: "Germany", city: "Stuttgart", lat: 48.7758, lng: 9.1829 },
  "bugatti": { country: "France", city: "Molsheim", lat: 48.5422, lng: 7.4933 },
  "koenigsegg": { country: "Sweden", city: "Angelholm", lat: 56.2425, lng: 12.8623 },
  "pagani": { country: "Italy", city: "Modena", lat: 44.6471, lng: 10.9252 },
  "mclaren": { country: "UK", city: "Woking", lat: 51.3148, lng: -0.5600 },
  "aston": { country: "UK", city: "Gaydon", lat: 52.1901, lng: -1.4870 },
  "renault": { country: "France", city: "Paris", lat: 48.8566, lng: 2.3522 },
  "dallara": { country: "Italy", city: "Parma", lat: 44.8015, lng: 10.3279 },
  "zagato": { country: "Italy", city: "Milan", lat: 45.4642, lng: 9.1900 },
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
  source?: string;
}

async function main() {
  console.log('🗺️  Enhanced Collection Location Mapping\n');

  const { data, error } = await supabase.from('import_queue')
    .select('id, listing_url, listing_title, raw_data')
    .eq('raw_data->>source', 'ecr')
    .eq('raw_data->>type', 'collection');

  if (error) {
    console.error('Error:', error);
    return;
  }

  const mapped: MappedCollection[] = [];
  const unmapped: string[] = [];

  data?.forEach(c => {
    const slug = c.listing_url.split('/').pop()?.toLowerCase() || '';
    let location = null;
    let source = '';

    // First check researched locations (exact match)
    if (researchedLocations[slug]) {
      location = researchedLocations[slug];
      source = location.source || 'researched';
    }

    // Then check pattern-based locations
    if (!location) {
      for (const [pattern, loc] of Object.entries(locationPatterns)) {
        if (slug.includes(pattern.toLowerCase())) {
          location = loc;
          source = 'pattern';
          break;
        }
      }
    }

    if (location) {
      const ig = c.raw_data?.instagram;
      mapped.push({
        id: c.id,
        slug,
        url: c.listing_url,
        instagram: ig !== 'exclusivecarregistry' ? ig : null,
        country: location.country,
        city: location.city,
        lat: location.lat,
        lng: location.lng,
        source
      });
    } else {
      unmapped.push(slug);
    }
  });

  console.log(`✅ Mapped: ${mapped.length} collections`);
  console.log(`❌ Unmapped: ${unmapped.length} collections\n`);

  // Stats
  const byCountry: Record<string, number> = {};
  mapped.forEach(m => {
    byCountry[m.country] = (byCountry[m.country] || 0) + 1;
  });

  console.log('By Country:');
  Object.entries(byCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
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
        city: m.city,
        source: m.source
      },
      geometry: {
        type: 'Point',
        coordinates: [m.lng, m.lat]
      }
    }))
  };

  fs.writeFileSync('data/collections-map-enhanced.geojson', JSON.stringify(geojson, null, 2));
  console.log('\n✅ Saved to data/collections-map-enhanced.geojson');

  // CSV
  const csv = [
    'slug,url,instagram,country,city,lat,lng,source',
    ...mapped.map(m => `"${m.slug}","${m.url}","${m.instagram || ''}","${m.country}","${m.city}",${m.lat},${m.lng},"${m.source}"`)
  ].join('\n');

  fs.writeFileSync('data/collections-map-enhanced.csv', csv);
  console.log('✅ Saved to data/collections-map-enhanced.csv');

  // Unmapped list
  fs.writeFileSync('data/collections-still-unmapped.txt', unmapped.join('\n'));
  console.log(`✅ ${unmapped.length} still unmapped saved to data/collections-still-unmapped.txt`);

  // Summary stats
  const researchedCount = mapped.filter(m => m.source !== 'pattern').length;
  const patternCount = mapped.filter(m => m.source === 'pattern').length;

  console.log(`\n📊 Summary:`);
  console.log(`   Researched locations: ${researchedCount}`);
  console.log(`   Pattern-matched: ${patternCount}`);
  console.log(`   Total mapped: ${mapped.length}`);
  console.log(`   Coverage: ${((mapped.length / (data?.length || 1)) * 100).toFixed(1)}%`);
}

main().catch(console.error);
