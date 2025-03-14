#!/usr/bin/env node

/**
 * Bring a Trailer Data Extractor for Vehicle Timeline
 * 
 * This script extracts real vehicle data from Bring a Trailer listings and saves it
 * to a JSON file that can be used to populate the vehicle_timeline_events table.
 * 
 * Usage:
 *   npm run bat:extract -- --url=<BAT_URL> --output=<OUTPUT_FILE>
 * 
 * Example:
 *   npm run bat:extract -- --url=https://bringatrailer.com/listing/1988-gmc-suburban-3/ --output=data/1988-suburban.json
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Prompt for user input
 * @param {string} question - The question to ask
 * @returns {Promise<string>} User input
 */
async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Extract vehicle data from Bring a Trailer listing URL
 * @param {string} url - BaT listing URL
 * @returns {Promise<Object>} Extracted vehicle data
 */
async function extractBaTData(url) {
  console.log(`${YELLOW}Extracting data from ${url}...${RESET}`);
  
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // Extract basic listing info
    const title = $('h1').first().text().trim();
    const soldPrice = $('.listing-available-sold-for').text().trim().replace(/[^0-9]/g, '');
    const soldDate = $('.listing-available-sold-date').text().trim();
    
    // Extract VIN
    let vin = '';
    $('.bat-entry-subheading:contains("Chassis")').next().find('a').each(function() {
      const vinText = $(this).text().trim();
      if (vinText.length > 10) {
        vin = vinText;
      }
    });
    
    // Extract data points
    const specs = {};
    $('.listing-essentials-items li').each(function() {
      const text = $(this).text().trim();
      if (text.includes(':')) {
        const [key, value] = text.split(':').map(item => item.trim());
        specs[key] = value;
      } else if (!text.includes('Chassis')) {
        // Add simple specs without key:value format
        specs[text] = true;
      }
    });
    
    // Extract miles/kilometers
    let mileage = null;
    let mileageUnit = 'miles';
    
    // Look for mileage in specs
    for (const key in specs) {
      if (key.toLowerCase().includes('mile') || key.toLowerCase().includes('odometer')) {
        const mileageText = specs[key];
        const mileageMatch = mileageText.match(/([0-9,]+)/);
        if (mileageMatch) {
          mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
          mileageUnit = mileageText.toLowerCase().includes('km') ? 'kilometers' : 'miles';
          break;
        }
      }
    }
    
    // If not found in specs, try to find in title or description
    if (!mileage) {
      const mileageMatch = title.match(/([0-9,]+)[k]?\s+(mile|km|kilometer)/i);
      if (mileageMatch) {
        mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
        mileageUnit = mileageMatch[2].toLowerCase().includes('km') ? 'kilometers' : 'miles';
      }
    }
    
    // Extract vehicle year, make, model
    let year = null;
    let make = null;
    let model = null;
    
    // Try to extract from title
    const titleParts = title.split(' ');
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      year = parseInt(yearMatch[0]);
      
      // Find the position of the year in the title
      const yearPos = titleParts.findIndex(part => part.includes(yearMatch[0]));
      if (yearPos >= 0 && yearPos + 2 < titleParts.length) {
        make = titleParts[yearPos + 1];
        model = titleParts[yearPos + 2];
      }
    }
    
    // Get seller and buyer
    const seller = $('.listing-available-sold-by').text().trim();
    const buyer = $('.listing-available-sold-to').text().trim();
    
    // Extract description
    let description = '';
    $('.bat-entry p').each(function() {
      const text = $(this).text().trim();
      if (text && !description.includes(text)) {
        description += text + ' ';
      }
    });
    
    // Extract all images - directly borrowing URLs from BaT
    console.log(`${YELLOW}Collecting image URLs from BaT (resource-efficient approach)${RESET}`);
    const images = [];
    
    // Gallery images
    $('.gallery-image').each(function() {
      const src = $(this).attr('src');
      if (src && !images.includes(src)) images.push(src);
    });
    
    // Large images
    $('img.alignnone').each(function() {
      const src = $(this).attr('src');
      if (src && !images.includes(src)) images.push(src);
    });
    
    // Any other images in the listing
    $('.bat-entry img').each(function() {
      const src = $(this).attr('src');
      if (src && !images.includes(src) && !src.includes('avatar') && !src.includes('logo')) {
        images.push(src);
      }
    });
    
    console.log(`${GREEN}✓ Successfully extracted ${images.length} image URLs from BaT listing${RESET}`);
    
    // Extract comments for additional insights
    const comments = [];
    $('.comment-author').each(function(i) {
      const author = $(this).text().trim();
      const commentBody = $(this).next('.comment-body').text().trim();
      const commentDate = $(this).next('.comment-body').next('.comment-date').text().trim();
      
      if (author && commentBody) {
        comments.push({
          author,
          body: commentBody,
          date: commentDate
        });
      }
    });
    
    // Create result object
    const vehicleData = {
      source: 'bring_a_trailer',
      source_url: url,
      source_id: url.split('/').pop(),
      title,
      vin,
      year,
      make,
      model,
      sold_price: soldPrice ? parseInt(soldPrice) : null,
      sold_date: soldDate,
      seller,
      buyer,
      specs,
      mileage: {
        value: mileage,
        unit: mileageUnit,
        tmu: description.toLowerCase().includes('tmu') || title.toLowerCase().includes('tmu')
      },
      description: description.trim(),
      image_urls: images,
      comments: comments.slice(0, 20) // Limit to first 20 comments
    };
    
    console.log(`${GREEN}✓ Successfully extracted data from BaT listing${RESET}`);
    console.log(`${YELLOW}Vehicle: ${year} ${make} ${model}${RESET}`);
    console.log(`${YELLOW}VIN: ${vin}${RESET}`);
    console.log(`${YELLOW}Price: $${vehicleData.sold_price?.toLocaleString() || 'Unknown'}${RESET}`);
    console.log(`${YELLOW}Images: ${images.length}${RESET}`);
    
    return vehicleData;
  } catch (error) {
    console.error(`${RED}✗ Error extracting data from BaT:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Create timeline events from vehicle data
 * @param {Object} vehicleData - Extracted vehicle data
 * @param {string} userId - User ID to associate with events
 * @returns {Array} Timeline events
 */
function createTimelineEvents(vehicleData, userId) {
  console.log(`${YELLOW}Creating timeline events from vehicle data...${RESET}`);
  
  try {
    const vehicleId = uuidv4(); // Generate a temporary vehicle ID
    const events = [];
    
    // Vehicle data template
    const vehicleRecord = {
      id: vehicleId,
      vin: vehicleData.vin,
      make: vehicleData.make,
      model: vehicleData.model,
      year: vehicleData.year,
      user_id: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // 1. Manufacture event
    const manufactureEvent = {
      id: uuidv4(),
      vehicle_id: vehicleId,
      event_type: 'manufacture',
      source: 'vin_database',
      event_date: `${vehicleData.year}-01-01T00:00:00Z`, // Use January 1st of the vehicle year
      title: 'Vehicle Manufactured',
      description: `${vehicleData.year} ${vehicleData.make} ${vehicleData.model} manufactured`,
      confidence_score: 95,
      metadata: {
        year: vehicleData.year,
        make: vehicleData.make,
        model: vehicleData.model,
        vin: vehicleData.vin
      },
      source_url: `https://vpic.nhtsa.dot.gov/decoder/Decoder/DecodeVin/${vehicleData.vin}`,
      image_urls: [vehicleData.image_urls[0]], // Use first image
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    events.push(manufactureEvent);
    
    // 2. BaT Listing event
    let soldDate = new Date();
    if (vehicleData.sold_date) {
      // Try to parse the BaT date format
      const dateParts = vehicleData.sold_date.match(/([A-Za-z]+) (\d+), (\d+)/);
      if (dateParts) {
        const month = dateParts[1];
        const day = parseInt(dateParts[2]);
        const year = parseInt(dateParts[3]);
        soldDate = new Date(`${month} ${day}, ${year}`);
      }
    }
    
    const listingEvent = {
      id: uuidv4(),
      vehicle_id: vehicleId,
      event_type: 'listing',
      source: 'bat_auction',
      event_date: soldDate.toISOString(),
      title: `Sold on Bring a Trailer`,
      description: vehicleData.sold_price 
        ? `Sold for $${vehicleData.sold_price.toLocaleString()} on Bring a Trailer`
        : `Sold on Bring a Trailer`,
      confidence_score: 98,
      metadata: {
        auction_id: vehicleData.source_id,
        sold_price: vehicleData.sold_price,
        seller: vehicleData.seller,
        buyer: vehicleData.buyer,
        specs: vehicleData.specs,
        title: vehicleData.title,
        mileage: vehicleData.mileage
      },
      source_url: vehicleData.source_url,
      image_urls: vehicleData.image_urls.slice(0, 5), // Take up to 5 images
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    events.push(listingEvent);
    
    // 3. Mileage reading event (if available)
    if (vehicleData.mileage && vehicleData.mileage.value) {
      const mileageEvent = {
        id: uuidv4(),
        vehicle_id: vehicleId,
        event_type: 'maintenance',
        source: 'bat_auction',
        event_date: soldDate.toISOString(), // Same as the listing date
        title: 'Odometer Reading',
        description: `${vehicleData.mileage.value.toLocaleString()} ${vehicleData.mileage.unit} shown${vehicleData.mileage.tmu ? ' (TMU)' : ''}`,
        confidence_score: 90,
        metadata: {
          mileage: vehicleData.mileage.value,
          unit: vehicleData.mileage.unit,
          tmu: vehicleData.mileage.tmu,
          type: 'odometer_reading'
        },
        source_url: vehicleData.source_url,
        image_urls: [], // No specific images for this event
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      events.push(mileageEvent);
    }
    
    // 4. Transfer of ownership event
    const ownershipEvent = {
      id: uuidv4(),
      vehicle_id: vehicleId,
      event_type: 'ownership',
      source: 'bat_auction',
      event_date: soldDate.toISOString(),
      title: 'Transfer of Ownership',
      description: vehicleData.buyer 
        ? `Sold by ${vehicleData.seller} to ${vehicleData.buyer}` 
        : `Sold to new owner`,
      confidence_score: 95,
      metadata: {
        seller: vehicleData.seller,
        buyer: vehicleData.buyer,
        price: vehicleData.sold_price,
        auction_site: 'Bring a Trailer'
      },
      source_url: vehicleData.source_url,
      image_urls: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    events.push(ownershipEvent);
    
    // Create interesting findings from the vehicle data
    // Extract interesting specifications or features
    const interestingSpecs = [];
    
    for (const [key, value] of Object.entries(vehicleData.specs)) {
      if (value === true) {
        interestingSpecs.push(key);
      } else if (typeof value === 'string' && value.length > 0) {
        interestingSpecs.push(`${key}: ${value}`);
      }
    }
    
    // Extract interesting insights from description
    const keywords = [
      'restored', 'modified', 'custom', 'original', 'numbers matching', 
      'engine', 'transmission', 'rebuilt', 'replaced', 'upgraded',
      'interior', 'exterior', 'paint', 'body', 'frame', 'chassis',
      'factory', 'rare', 'limited', 'special', 'edition'
    ];
    
    const descriptionSentences = vehicleData.description.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    const interestingSentences = descriptionSentences.filter(sentence => 
      keywords.some(keyword => sentence.toLowerCase().includes(keyword.toLowerCase()))
    );
    
    // Add component events based on interesting findings
    if (interestingSpecs.length > 0 || interestingSentences.length > 0) {
      // Create groups of related findings
      const engines = interestingSpecs.filter(spec => spec.toLowerCase().includes('engine') || spec.toLowerCase().includes('motor'));
      const transmission = interestingSpecs.filter(spec => spec.toLowerCase().includes('transmission') || spec.toLowerCase().includes('speed'));
      const exterior = interestingSpecs.filter(spec => spec.toLowerCase().includes('paint') || spec.toLowerCase().includes('color') || spec.toLowerCase().includes('exterior'));
      const interior = interestingSpecs.filter(spec => spec.toLowerCase().includes('interior') || spec.toLowerCase().includes('seat') || spec.toLowerCase().includes('upholstery'));
      
      // Add engine event if we have engine info
      if (engines.length > 0) {
        const engineSentences = interestingSentences.filter(s => s.toLowerCase().includes('engine') || s.toLowerCase().includes('motor'));
        const engineEvent = {
          id: uuidv4(),
          vehicle_id: vehicleId,
          event_type: 'component',
          source: 'bat_auction',
          event_date: soldDate.toISOString(),
          title: 'Engine Information',
          description: engines.join(', ') + (engineSentences.length > 0 ? '. ' + engineSentences[0] : ''),
          confidence_score: 85,
          metadata: {
            component_type: 'engine',
            specs: engines,
            details: engineSentences
          },
          source_url: vehicleData.source_url,
          image_urls: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        events.push(engineEvent);
      }
      
      // Add transmission event if we have transmission info
      if (transmission.length > 0) {
        const transmissionEvent = {
          id: uuidv4(),
          vehicle_id: vehicleId,
          event_type: 'component',
          source: 'bat_auction',
          event_date: soldDate.toISOString(),
          title: 'Transmission Information',
          description: transmission.join(', '),
          confidence_score: 85,
          metadata: {
            component_type: 'transmission',
            specs: transmission
          },
          source_url: vehicleData.source_url,
          image_urls: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        events.push(transmissionEvent);
      }
      
      // Add exterior event if we have exterior info
      if (exterior.length > 0) {
        const exteriorSentences = interestingSentences.filter(s => s.toLowerCase().includes('paint') || s.toLowerCase().includes('exterior') || s.toLowerCase().includes('repaint'));
        
        // Find color-related images
        const colorImages = [];
        const colorTerms = exterior.join(' ').toLowerCase();
        const colorKeywords = ['blue', 'red', 'green', 'yellow', 'black', 'white', 'silver', 'gold', 'tan', 'brown', 'orange', 'purple', 'gray', 'grey'];
        const presentColors = colorKeywords.filter(color => colorTerms.includes(color));
        
        // Try to find images that show the exterior color well
        if (presentColors.length > 0 && vehicleData.image_urls.length > 0) {
          // Just take a couple exterior shots
          colorImages.push(vehicleData.image_urls[0]);
          if (vehicleData.image_urls.length > 3) {
            colorImages.push(vehicleData.image_urls[3]);
          }
        }
        
        const exteriorEvent = {
          id: uuidv4(),
          vehicle_id: vehicleId,
          event_type: 'component',
          source: 'bat_auction',
          event_date: soldDate.toISOString(),
          title: 'Exterior Information',
          description: exterior.join(', ') + (exteriorSentences.length > 0 ? '. ' + exteriorSentences[0] : ''),
          confidence_score: 85,
          metadata: {
            component_type: 'exterior',
            specs: exterior,
            details: exteriorSentences
          },
          source_url: vehicleData.source_url,
          image_urls: colorImages,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        events.push(exteriorEvent);
      }
      
      // Add interior event if we have interior info
      if (interior.length > 0) {
        const interiorSentences = interestingSentences.filter(s => s.toLowerCase().includes('interior') || s.toLowerCase().includes('seat') || s.toLowerCase().includes('upholstery'));
        
        // Find interior images
        const interiorImages = [];
        // Look for images that might be interior shots - usually in the middle of the sequence
        if (vehicleData.image_urls.length > 5) {
          const middleIndex = Math.floor(vehicleData.image_urls.length / 2);
          interiorImages.push(vehicleData.image_urls[middleIndex]);
        }
        
        const interiorEvent = {
          id: uuidv4(),
          vehicle_id: vehicleId,
          event_type: 'component',
          source: 'bat_auction',
          event_date: soldDate.toISOString(),
          title: 'Interior Information',
          description: interior.join(', ') + (interiorSentences.length > 0 ? '. ' + interiorSentences[0] : ''),
          confidence_score: 85,
          metadata: {
            component_type: 'interior',
            specs: interior,
            details: interiorSentences
          },
          source_url: vehicleData.source_url,
          image_urls: interiorImages,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        events.push(interiorEvent);
      }
    }
    
    // Create vehicle history timeline data
    const timelineData = {
      vehicle: vehicleRecord,
      events: events,
      user_id: userId,
      metadata: {
        extracted_at: new Date().toISOString(),
        source: 'bring_a_trailer',
        source_url: vehicleData.source_url,
        version: '1.0.0'
      }
    };
    
    console.log(`${GREEN}✓ Created ${events.length} timeline events${RESET}`);
    
    return timelineData;
  } catch (error) {
    console.error(`${RED}✗ Error creating timeline events:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Save data to a JSON file
 * @param {Object} data - Data to save
 * @param {string} outputPath - Path to save the data to
 */
async function saveDataToJsonFile(data, outputPath) {
  try {
    // Create directory if it doesn't exist
    const directory = path.dirname(outputPath);
    try {
      await fs.access(directory);
    } catch (error) {
      await fs.mkdir(directory, { recursive: true });
      console.log(`${GREEN}✓ Created directory ${directory}${RESET}`);
    }
    
    // Write data to file
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
    console.log(`${GREEN}✓ Saved data to ${outputPath}${RESET}`);
    
    return true;
  } catch (error) {
    console.error(`${RED}✗ Error saving data:${RESET}`, error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  console.log(`${YELLOW}===================================================${RESET}`);
  console.log(`${YELLOW}Bring a Trailer Data Extractor for Vehicle Timeline${RESET}`);
  console.log(`${YELLOW}===================================================${RESET}`);
  
  try {
    // Get CLI arguments
    const args = process.argv.slice(2);
    let url = '';
    let outputFile = '';
    let userId = '';
    
    // Parse command line arguments
    args.forEach(arg => {
      if (arg.startsWith('--url=')) {
        url = arg.substring(6);
      } else if (arg.startsWith('--output=')) {
        outputFile = arg.substring(9);
      } else if (arg.startsWith('--user=')) {
        userId = arg.substring(7);
      }
    });
    
    // Prompt for URL if not provided
    if (!url) {
      url = await prompt('Enter Bring a Trailer listing URL: ');
    }
    
    if (!url) {
      console.error(`${RED}✗ URL is required${RESET}`);
      process.exit(1);
    }
    
    // Prompt for user ID if not provided
    if (!userId) {
      userId = await prompt('Enter user ID (press Enter for random UUID): ');
      // Generate a random UUID if not provided
      if (!userId) {
        userId = uuidv4();
        console.log(`${YELLOW}Generated random user ID: ${userId}${RESET}`);
      }
    }
    
    // Validate that userId is a proper UUID format
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(userId)) {
      console.log(`${YELLOW}Provided ID "${userId}" is not a valid UUID format${RESET}`);
      userId = uuidv4();
      console.log(`${YELLOW}Using generated UUID instead: ${userId}${RESET}`);
    }
    
    // Set default output file if not provided
    if (!outputFile) {
      const urlParts = url.split('/');
      const slug = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
      outputFile = `data/${slug}.json`;
      console.log(`${YELLOW}Using default output file: ${outputFile}${RESET}`);
    }
    
    // Extract data from BaT
    const vehicleData = await extractBaTData(url);
    
    // Create timeline events
    const timelineData = createTimelineEvents(vehicleData, userId);
    
    // Save data to JSON file
    await saveDataToJsonFile(timelineData, outputFile);
    
    console.log(`${GREEN}✓ Data extraction and timeline event creation complete${RESET}`);
    console.log(`${YELLOW}Next steps:${RESET}`);
    console.log(`${YELLOW}1. Run the SQL function creation script in Supabase SQL Editor:${RESET}`);
    console.log(`${CYAN}   npm run timeline:setup${RESET}`);
    console.log(`${YELLOW}2. Once the admin functions are available, run the timeline seeder with your data:${RESET}`);
    console.log(`${CYAN}   node scripts/seed-timeline-from-file.js --file=${outputFile}${RESET}`);
    
  } catch (error) {
    console.error(`${RED}✗ Error:${RESET}`, error.message);
    process.exit(1);
  }
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
