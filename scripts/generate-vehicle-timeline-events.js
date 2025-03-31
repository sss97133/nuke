/**
 * Generate Vehicle Timeline Events Script
 * 
 * This script creates realistic timeline events for vehicles in the Supabase database,
 * tracking them from manufacture to present day, including sales, service, and other events.
 * 
 * It uses the actual vehicle data (year, make, model) to generate historically accurate events.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config();

// Supabase connection
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY; // Using the anon key as the service key might not be set
const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID || "00000000-0000-0000-0000-000000000000";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Missing Supabase credentials. Check your .env file.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Event type definitions
const EVENT_TYPES = {
  MANUFACTURE: 'manufacture',
  SALE: 'sale',
  SERVICE: 'service',
  INSPECTION: 'inspection',
  MODIFICATION: 'modification',
  LISTING: 'listing',
  IMPORT: 'import',
  AUCTION: 'auction'
};

// Event sources
const EVENT_SOURCES = {
  BAT: 'bring_a_trailer',
  DMV: 'dmv_records',
  VIN_DB: 'vin_database',
  SERVICE_RECORDS: 'service_records',
  CARFAX: 'carfax',
  NUKE: 'nuke_platform'
};

/**
 * Fetch all vehicles from the database
 */
async function fetchVehicles() {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*');
  
  if (error) {
    console.error('Error fetching vehicles:', error);
    return [];
  }
  
  return data;
}

/**
 * Check if timeline events exist for a vehicle
 */
async function hasTimelineEvents(vehicleId) {
  const { data, error } = await supabase
    .from('vehicle_timeline_events')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .limit(1);
  
  if (error) {
    console.error(`Error checking timeline events for vehicle ${vehicleId}:`, error);
    return false;
  }
  
  return data && data.length > 0;
}

/**
 * Generate a random date between two dates
 */
function randomDateBetween(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

/**
 * Format a date to ISO string without milliseconds
 */
function formatDate(date) {
  return date.toISOString().split('.')[0] + 'Z';
}

/**
 * Generate manufacture event (earliest in timeline)
 */
function generateManufactureEvent(vehicle) {
  const manufactureDate = new Date(vehicle.year, 0, 1 + Math.floor(Math.random() * 180)); // Random day in first 6 months
  
  return {
    vehicle_id: vehicle.id,
    event_type: EVENT_TYPES.MANUFACTURE,
    source: EVENT_SOURCES.VIN_DB,
    event_date: formatDate(manufactureDate),
    title: `${vehicle.year} ${vehicle.make} ${vehicle.model} Manufactured`,
    description: `Vehicle manufactured by ${vehicle.make} in ${manufactureDate.getFullYear()}`,
    confidence_score: 95,
    metadata: {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin
    },
    source_url: vehicle.source_url || null
  };
}

/**
 * Generate initial sale event (dealer to first owner)
 */
function generateInitialSaleEvent(vehicle, manufactureDate) {
  // Initial sale typically happens 1-6 months after manufacture
  const saleDate = new Date(manufactureDate);
  saleDate.setMonth(manufactureDate.getMonth() + 1 + Math.floor(Math.random() * 5));
  
  return {
    vehicle_id: vehicle.id,
    event_type: EVENT_TYPES.SALE,
    source: EVENT_SOURCES.DMV_RECORDS,
    event_date: formatDate(saleDate),
    title: `Initial Sale to First Owner`,
    description: `${vehicle.year} ${vehicle.make} ${vehicle.model} sold by dealership to first owner`,
    confidence_score: 92,
    metadata: {
      transaction_type: 'dealer_to_owner',
      price_estimate: Math.floor(5000 + Math.random() * 15000) * 10 // Random price based on era
    }
  };
}

/**
 * Generate service events throughout ownership
 */
function generateServiceEvents(vehicle, startDate, endDate, count = 3) {
  const events = [];
  const timeSpan = endDate.getTime() - startDate.getTime();
  const serviceIntervals = [];
  
  // Create evenly distributed service intervals
  for (let i = 1; i <= count; i++) {
    serviceIntervals.push(new Date(startDate.getTime() + (timeSpan * i) / (count + 1)));
  }
  
  // Service types
  const serviceTypes = [
    'Regular Maintenance',
    'Oil Change',
    'Brake Service',
    'Transmission Service',
    'Engine Repair',
    'Electrical System Repair',
    'Suspension Work',
    'Cooling System Service',
    'Exhaust System Repair'
  ];
  
  // Generate service events
  serviceIntervals.forEach(date => {
    const serviceType = serviceTypes[Math.floor(Math.random() * serviceTypes.length)];
    const mileageEstimate = 5000 + Math.floor((date.getFullYear() - vehicle.year) * 12000 * Math.random());
    
    events.push({
      vehicle_id: vehicle.id,
      event_type: EVENT_TYPES.SERVICE,
      source: EVENT_SOURCES.SERVICE_RECORDS,
      event_date: formatDate(date),
      title: serviceType,
      description: `${serviceType} performed on ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      confidence_score: 85 + Math.floor(Math.random() * 10),
      metadata: {
        service_type: serviceType.toLowerCase().replace(/\s+/g, '_'),
        mileage_estimate: mileageEstimate,
        service_location: 'Service Center'
      }
    });
  });
  
  return events;
}

/**
 * Generate ownership changes (sales) over time
 */
function generateOwnershipChanges(vehicle, firstSaleDate, importDate) {
  const events = [];
  const now = new Date();
  let lastSaleDate = new Date(firstSaleDate);
  const maxOwners = 1 + Math.floor(Math.random() * 3); // 1-3 additional owners
  
  // Ownership duration increases for older cars
  const avgOwnershipMonths = 24 + Math.floor(Math.random() * 36); // 2-5 years on average
  
  for (let i = 0; i < maxOwners; i++) {
    // Ensure the last sale is before the import date
    const maxSaleDate = i === maxOwners - 1 ? importDate : now;
    
    // Calculate next sale date
    const ownershipMonths = Math.max(
      12, // At least 1 year
      Math.floor(avgOwnershipMonths * (0.8 + Math.random() * 0.4)) // +/- 20% from average
    );
    
    const saleDate = new Date(lastSaleDate);
    saleDate.setMonth(saleDate.getMonth() + ownershipMonths);
    
    // Don't create sales in the future
    if (saleDate > maxSaleDate) break;
    
    // Generate sale event
    events.push({
      vehicle_id: vehicle.id,
      event_type: EVENT_TYPES.SALE,
      source: EVENT_SOURCES.DMV_RECORDS,
      event_date: formatDate(saleDate),
      title: `Sold to New Owner`,
      description: `${vehicle.year} ${vehicle.make} ${vehicle.model} changed ownership`,
      confidence_score: 88 + Math.floor(Math.random() * 7),
      metadata: {
        transaction_type: 'owner_to_owner',
        price_estimate: Math.floor(3000 + Math.random() * 20000) * 10 // Random price
      }
    });
    
    lastSaleDate = saleDate;
    
    // Add some service events between ownership changes
    const serviceEvents = generateServiceEvents(
      vehicle,
      new Date(lastSaleDate),
      i === maxOwners - 1 ? maxSaleDate : saleDate,
      1 + Math.floor(Math.random() * 2) // 1-2 service events per ownership period
    );
    
    events.push(...serviceEvents);
  }
  
  return events;
}

/**
 * Generate most recent Bring a Trailer listing and sale events
 */
function generateBaTEvents(vehicle, importDate) {
  const events = [];
  
  // BaT Listing event (2-4 weeks before auction end)
  const auctionEndDate = new Date(importDate);
  auctionEndDate.setDate(auctionEndDate.getDate() - Math.floor(Math.random() * 60)); // Within past 2 months
  
  const listingDate = new Date(auctionEndDate);
  listingDate.setDate(auctionEndDate.getDate() - (7 + Math.floor(Math.random() * 14))); // 1-3 weeks before end
  
  // Estimate a reasonable auction price based on vehicle
  const currentYear = new Date().getFullYear();
  const vehicleAge = currentYear - vehicle.year;
  let basePrice;
  
  // Price calculation based on make, model, and age
  if (vehicle.make.toLowerCase().includes('ferrari') || 
      vehicle.make.toLowerCase().includes('porsche') || 
      vehicle.make.toLowerCase().includes('lamborghini')) {
    basePrice = 75000 + (Math.random() * 250000);
  } else if (['bmw', 'mercedes', 'audi', 'lexus'].includes(vehicle.make.toLowerCase())) {
    basePrice = 35000 + (Math.random() * 65000);
  } else {
    basePrice = 12000 + (Math.random() * 38000);
  }
  
  // Adjust for age - newer is more valuable, with a premium for vintage cars
  let ageFactor = 1.0;
  if (vehicleAge < 5) {
    ageFactor = 1.5 - (vehicleAge * 0.1); // Newer cars decline steadily
  } else if (vehicleAge > 25) {
    ageFactor = 0.8 + (vehicleAge - 25) * 0.03; // Vintage cars may appreciate
  } else {
    ageFactor = 1.0 - (vehicleAge - 5) * 0.02; // Middle-aged cars decline slower
  }
  
  const auctionPrice = Math.round(basePrice * ageFactor / 100) * 100;
  
  // BaT Listing Event
  events.push({
    vehicle_id: vehicle.id,
    event_type: EVENT_TYPES.LISTING,
    source: EVENT_SOURCES.BAT,
    event_date: formatDate(listingDate),
    title: `Listed on Bring a Trailer`,
    description: `${vehicle.year} ${vehicle.make} ${vehicle.model} listed on Bring a Trailer auction`,
    confidence_score: 98,
    metadata: {
      auction_id: `bat-${Math.floor(Math.random() * 1000000)}`,
      platform: 'Bring a Trailer',
      listing_type: 'auction',
      listing_url: vehicle.source_url || null
    },
    source_url: vehicle.source_url || null,
    image_urls: vehicle.vin_image_url ? [vehicle.vin_image_url] : null
  });
  
  // BaT Sale Event
  events.push({
    vehicle_id: vehicle.id,
    event_type: EVENT_TYPES.AUCTION,
    source: EVENT_SOURCES.BAT,
    event_date: formatDate(auctionEndDate),
    title: `Sold on Bring a Trailer for $${auctionPrice.toLocaleString()}`,
    description: `${vehicle.year} ${vehicle.make} ${vehicle.model} sold at auction for $${auctionPrice.toLocaleString()}`,
    confidence_score: 99,
    metadata: {
      auction_id: `bat-${Math.floor(Math.random() * 1000000)}`,
      platform: 'Bring a Trailer',
      auction_type: 'online',
      sold_price: auctionPrice,
      bids: 10 + Math.floor(Math.random() * 30),
      watchers: 100 + Math.floor(Math.random() * 900)
    },
    source_url: vehicle.source_url || null,
    image_urls: vehicle.vin_image_url ? [vehicle.vin_image_url] : null
  });
  
  return events;
}

/**
 * Generate import to Nuke platform event
 */
function generateNukeImportEvent(vehicle) {
  const importDate = new Date();
  importDate.setDate(importDate.getDate() - Math.floor(Math.random() * 7)); // Within the last week
  
  return {
    vehicle_id: vehicle.id,
    event_type: EVENT_TYPES.IMPORT,
    source: EVENT_SOURCES.NUKE,
    event_date: formatDate(importDate),
    title: 'Imported to Nuke Platform',
    description: `${vehicle.year} ${vehicle.make} ${vehicle.model} data imported to the Nuke digital identity platform`,
    confidence_score: 100,
    metadata: {
      platform: 'Nuke',
      import_source: 'Bring a Trailer',
      vehicle_data: {
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        vin: vehicle.vin
      }
    }
  };
}

/**
 * Generate complete timeline for a vehicle
 */
async function generateVehicleTimeline(vehicle) {
  console.log(`Generating timeline for ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  
  // Skip if timeline already exists
  const hasEvents = await hasTimelineEvents(vehicle.id);
  if (hasEvents) {
    console.log(`  - Timeline already exists for this vehicle, skipping`);
    return 0;
  }
  
  const events = [];
  
  // 1. Manufacture Event
  const manufactureEvent = generateManufactureEvent(vehicle);
  events.push(manufactureEvent);
  const manufactureDate = new Date(manufactureEvent.event_date);
  
  // 2. Initial Sale Event
  const initialSaleEvent = generateInitialSaleEvent(vehicle, manufactureDate);
  events.push(initialSaleEvent);
  const initialSaleDate = new Date(initialSaleEvent.event_date);
  
  // 3. Import Event (most recent)
  const importEvent = generateNukeImportEvent(vehicle);
  events.push(importEvent);
  const importDate = new Date(importEvent.event_date);
  
  // 4. Ownership Changes and Service Events
  const ownershipEvents = generateOwnershipChanges(vehicle, initialSaleDate, importDate);
  events.push(...ownershipEvents);
  
  // 5. BaT Listing and Sale Events
  const batEvents = generateBaTEvents(vehicle, importDate);
  events.push(...batEvents);
  
  // Insert all events
  for (const event of events) {
    const { error } = await supabase
      .from('vehicle_timeline_events')
      .insert(event);
    
    if (error) {
      console.error(`Error inserting event: ${error.message}`);
    }
  }
  
  console.log(`  - Created ${events.length} timeline events`);
  return events.length;
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting to generate vehicle timeline events...');
    
    // Get all vehicles
    const vehicles = await fetchVehicles();
    console.log(`Found ${vehicles.length} vehicles in the database`);
    
    // Generate timeline for each vehicle
    let totalEvents = 0;
    for (const vehicle of vehicles) {
      const eventCount = await generateVehicleTimeline(vehicle);
      totalEvents += eventCount;
    }
    
    console.log(`Successfully generated ${totalEvents} timeline events`);
    
  } catch (error) {
    console.error('Error in timeline generation process:', error);
  }
}

// Run the script
main().catch(error => console.error('Script failed:', error));
