/**
 * Script to populate the database with real vehicle data from Bring a Trailer
 * 
 * This script focuses on acquiring real square body trucks and classic vehicles
 * with actual VINs, following the vehicle-centric architecture principle where
 * all vehicles start with real data but no claimed owner.
 * 
 * Run with: npm run populate-vehicles
 */

import { BringATrailerScraper } from '../integrations/mcp/bringtrailer/BringATrailerScraper';

async function main() {
  console.log('Starting vehicle data population from Bring a Trailer...');
  console.log('This will add real vehicle data with VINs but no claimed owners');
  
  const vehicleCount = process.argv[2] ? parseInt(process.argv[2]) : 100;
  
  console.log(`Target: ${vehicleCount} vehicles`);
  
  const scraper = new BringATrailerScraper();
  
  try {
    await scraper.run(vehicleCount);
    console.log('Vehicle data population complete!');
  } catch (error) {
    console.error('Error populating vehicle data:', error);
    process.exit(1);
  }
}

main();
