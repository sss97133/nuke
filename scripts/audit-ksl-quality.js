#!/usr/bin/env node
/**
 * Comprehensive audit of KSL extraction quality
 * Compares what we extracted vs what's available on source
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  console.log('='.repeat(60));
  console.log('KSL EXTRACTION QUALITY AUDIT');
  console.log('='.repeat(60));
  console.log('');

  // Get all KSL vehicles
  const { data: vehicles, error } = await supabase.from('vehicles')
    .select('*')
    .eq('discovery_source', 'ksl_automated_import')
    .order('created_at', { ascending: false });
    
  if (error) { 
    console.error('Error:', error); 
    return; 
  }
  
  console.log('Total KSL vehicles:', vehicles.length);
  console.log('');
  
  // Data quality metrics
  const metrics = {
    vin: 0, mileage: 0, asking_price: 0, description: 0,
    year: 0, make: 0, model: 0, trim: 0, body_style: 0,
    exterior_color: 0, interior_color: 0, engine: 0, transmission: 0,
    discovery_url: 0, title_type: 0
  };
  
  const issues = [];
  
  vehicles.forEach(v => {
    if (v.vin) metrics.vin++;
    if (v.mileage) metrics.mileage++;
    if (v.asking_price) metrics.asking_price++;
    if (v.description && v.description.length > 50) metrics.description++;
    if (v.year) metrics.year++;
    if (v.make) metrics.make++;
    if (v.model) metrics.model++;
    if (v.trim) metrics.trim++;
    if (v.body_style) metrics.body_style++;
    if (v.exterior_color) metrics.exterior_color++;
    if (v.interior_color) metrics.interior_color++;
    if (v.engine) metrics.engine++;
    if (v.transmission) metrics.transmission++;
    if (v.discovery_url) metrics.discovery_url++;
    
    // Check for issues
    if (!v.mileage && v.description?.match(/\d{1,3}(?:,\d{3})*\s*(?:miles|mi)/i)) {
      issues.push({ vehicle: `${v.year} ${v.make} ${v.model}`, issue: 'Mileage in description but not extracted' });
    }
    if (!v.vin && v.description?.match(/[A-HJ-NPR-Z0-9]{17}/)) {
      issues.push({ vehicle: `${v.year} ${v.make} ${v.model}`, issue: 'VIN in description but not extracted' });
    }
    if (v.description?.includes('youtube') || v.description?.includes('svg') || v.description?.includes('<')) {
      issues.push({ vehicle: `${v.year} ${v.make} ${v.model}`, issue: 'Description contains garbage (HTML/SVG/YouTube)' });
    }
  });
  
  const n = vehicles.length;
  console.log('DATA QUALITY METRICS:');
  console.log('-'.repeat(40));
  Object.entries(metrics).forEach(([key, count]) => {
    const pct = Math.round(count/n*100);
    const bar = '█'.repeat(Math.floor(pct/5)) + '░'.repeat(20 - Math.floor(pct/5));
    const status = pct === 100 ? 'OK' : pct >= 80 ? 'GOOD' : pct >= 50 ? 'FAIR' : 'POOR';
    console.log(`  ${key.padEnd(20)} ${bar} ${count}/${n} (${pct}%) [${status}]`);
  });
  console.log('');
  
  // Image counts
  console.log('IMAGE COUNTS:');
  console.log('-'.repeat(40));
  let totalImages = 0;
  let vehiclesWithImages = 0;
  for (const v of vehicles) {
    const { count } = await supabase.from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', v.id);
    if (count > 0) vehiclesWithImages++;
    totalImages += count || 0;
    console.log(`  ${v.year} ${v.make} ${v.model}: ${count || 0} images`);
  }
  console.log('');
  console.log(`  Total images: ${totalImages}`);
  console.log(`  Vehicles with images: ${vehiclesWithImages}/${n}`);
  console.log('');
  
  // Timeline events
  console.log('TIMELINE EVENTS:');
  console.log('-'.repeat(40));
  const { data: events } = await supabase.from('timeline_events')
    .select('vehicle_id, event_type, event_date, title')
    .in('vehicle_id', vehicles.map(v => v.id));
  
  const eventsByVehicle = {};
  (events || []).forEach(e => {
    if (!eventsByVehicle[e.vehicle_id]) eventsByVehicle[e.vehicle_id] = [];
    eventsByVehicle[e.vehicle_id].push(e);
  });
  
  let vehiclesWithEvents = 0;
  for (const v of vehicles) {
    const vEvents = eventsByVehicle[v.id] || [];
    if (vEvents.length > 0) vehiclesWithEvents++;
    console.log(`  ${v.year} ${v.make} ${v.model}: ${vEvents.length} events`);
    vEvents.forEach(e => {
      console.log(`    - ${e.event_type}: ${e.title} (${e.event_date})`);
    });
  }
  console.log('');
  console.log(`  Vehicles with timeline events: ${vehiclesWithEvents}/${n}`);
  console.log('');
  
  // Issues found
  if (issues.length > 0) {
    console.log('ISSUES FOUND:');
    console.log('-'.repeat(40));
    issues.forEach(i => {
      console.log(`  ${i.vehicle}: ${i.issue}`);
    });
    console.log('');
  }
  
  // Sample detailed view
  console.log('SAMPLE VEHICLE DETAILS:');
  console.log('-'.repeat(40));
  for (const v of vehicles.slice(0, 3)) {
    console.log('');
    console.log(`>>> ${v.year} ${v.make} ${v.model} <<<`);
    console.log(`  ID: ${v.id}`);
    console.log(`  VIN: ${v.vin || 'NOT EXTRACTED'}`);
    console.log(`  Mileage: ${v.mileage || 'NOT EXTRACTED'}`);
    console.log(`  Price: ${v.asking_price ? '$' + v.asking_price.toLocaleString() : 'NOT EXTRACTED'}`);
    console.log(`  Exterior Color: ${v.exterior_color || 'NOT EXTRACTED'}`);
    console.log(`  Interior Color: ${v.interior_color || 'NOT EXTRACTED'}`);
    console.log(`  Engine: ${v.engine || 'NOT EXTRACTED'}`);
    console.log(`  Transmission: ${v.transmission || 'NOT EXTRACTED'}`);
    console.log(`  Trim: ${v.trim || 'NOT EXTRACTED'}`);
    console.log(`  Body Style: ${v.body_style || 'NOT EXTRACTED'}`);
    console.log(`  Title Type: ${v.title_type || 'NOT EXTRACTED'}`);
    console.log(`  Location: ${v.location || 'NOT EXTRACTED'}`);
    console.log(`  Source URL: ${v.discovery_url || 'NOT EXTRACTED'}`);
    console.log(`  Location: ${v.origin_metadata?.location || 'NOT EXTRACTED'}`);
    console.log(`  Body Style: ${v.origin_metadata?.body_style || 'NOT EXTRACTED'}`);
    console.log(`  Description: ${v.description ? v.description.substring(0, 200) + '...' : 'NOT EXTRACTED'}`);
  }
  
  console.log('');
  console.log('='.repeat(60));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(60));
}

audit().catch(console.error);

