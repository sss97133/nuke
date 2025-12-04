#!/usr/bin/env node
/**
 * Import Cameron's 1983 K2500 Build Estimate
 * Handles multiple sections, labor calculations, and organization attribution
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VEHICLE_ID = '5a1deb95-4b67-4cc3-9575-23bb5b180693';
const LABOR_RATE = 150; // $150/hr from CSV

async function main() {
  console.log('📊 Importing 1983 GMC K2500 Build Estimate\n');
  
  // Read CSV
  const csvPath = '/Users/skylar/Library/Mobile Documents/com~apple~Numbers/Documents/cameron/1983 k2500 estimate.csv';
  const csvContent = readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n');
  
  // Parse line items (rows 4-63 = original estimate, rows 88-188 = Sept update)
  const originalItems = parseLineItems(lines.slice(3, 64), 'Original Estimate');
  const septItems = parseLineItems(lines.slice(87, 188), 'Sept Update');
  
  console.log(`Original estimate: ${originalItems.length} line items`);
  console.log(`Sept update: ${septItems.length} line items`);
  console.log('');
  
  // Use Sept update (most recent)
  const items = septItems;
  
  // Group by category
  const byCategory = {};
  items.forEach(item => {
    const cat = item.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  });
  
  console.log('Categories found:');
  Object.entries(byCategory).forEach(([cat, items]) => {
    const total = items.reduce((sum, i) => sum + (i.part_cost || 0) + (i.labor_cost || 0), 0);
    console.log(`  ${cat}: ${items.length} items, $${total.toFixed(2)}`);
  });
  console.log('');
  
  // Create build project
  console.log('📝 Creating build project...');
  const { data: build, error: buildError } = await supabase
    .from('vehicle_builds')
    .insert({
      vehicle_id: VEHICLE_ID,
      name: 'K2500 Restoration - Sept 2024 Estimate',
      description: 'Complete restoration estimate from Cameron. Paint by Taylor Customs, Interior by Ernies Upholstery. Original: $24,942.63 → Sept Update: $31,633.41. Trade-in: 1GCEK14L9EJ147915',
      status: 'in_progress',
      total_budget: 31633.41,  // Sept update total
      total_spent: 0,
      start_date: '2024-09-01'
    })
    .select()
    .single();
  
  if (buildError) {
    console.error('❌ Error creating build:', buildError);
    return;
  }
  
  console.log(`✅ Build created: ${build.id}\n`);
  
  // Import line items
  console.log('📦 Importing line items...');
  let imported = 0;
  
  for (const item of items) {
    if (!item.description) continue;
    
    // Determine supplier based on category
    let supplier = 'Unknown';
    if (item.category === 'Paint') supplier = 'Taylor Customs';
    else if (item.category === 'Interior') supplier = 'Ernies Upholstery';
    else if (item.category === 'Mechanical') supplier = 'General Supplier';
    else if (item.category === 'Undercarriage') supplier = 'Detail Shop';
    
    const totalCost = (item.part_cost || 0) + (item.labor_cost || 0);
    
    const { error: itemError } = await supabase
      .from('build_line_items')
      .insert({
        build_id: build.id,
        name: item.description,
        description: `${item.category || 'General'} work: ${item.description}. Minutes: ${item.minutes || 0}. Labor: ${item.labor_hours?.toFixed(1) || 0}hrs @ $${LABOR_RATE}/hr = $${item.labor_cost?.toFixed(2) || 0}. Parts: $${item.part_cost?.toFixed(2) || 0}`,
        quantity: 1,
        unit_price: item.part_cost || 0,
        total_price: totalCost,
        status: 'pending'
      });
    
    if (itemError) {
      console.error(`  ❌ Error importing ${item.description}:`, itemError.message);
    } else {
      imported++;
    }
  }
  
  console.log(`✅ Imported ${imported} line items\n`);
  
  // Create work orders for each organization
  console.log('🏪 Creating organization work orders...');
  
  // Taylor Customs - Paint work
  const paintItems = items.filter(i => i.category === 'Paint');
  const paintLaborHours = paintItems.reduce((sum, i) => sum + (i.labor_hours || 0), 0);
  const paintLaborCost = paintLaborHours * LABOR_RATE;
  const paintPartsCost = paintItems.reduce((sum, i) => sum + (i.part_cost || 0), 0);
  const paintTotal = paintLaborCost + paintPartsCost;
  
  console.log(`\n  Paint work (Taylor Customs):`);
  console.log(`    Labor: ${paintLaborHours.toFixed(1)} hrs @ $150/hr = $${paintLaborCost.toFixed(2)}`);
  console.log(`    Parts: $${paintPartsCost.toFixed(2)}`);
  console.log(`    Total: $${paintTotal.toFixed(2)}`);
  
  // Ernies - Interior work
  const interiorItems = items.filter(i => i.category === 'Interior');
  const interiorLaborHours = interiorItems.reduce((sum, i) => sum + (i.labor_hours || 0), 0);
  const interiorLaborCost = interiorLaborHours * LABOR_RATE;
  const interiorPartsCost = interiorItems.reduce((sum, i) => sum + (i.part_cost || 0), 0);
  const interiorTotal = interiorLaborCost + interiorPartsCost;
  
  console.log(`\n  Interior work (Ernies Upholstery):`);
  console.log(`    Labor: ${interiorLaborHours.toFixed(1)} hrs @ $150/hr = $${interiorLaborCost.toFixed(2)}`);
  console.log(`    Parts: $${interiorPartsCost.toFixed(2)}`);
  console.log(`    Total: $${interiorTotal.toFixed(2)}`);
  
  console.log('\n✅ BUILD ESTIMATE IMPORTED!\n');
  console.log(`Total budget: $31,633.41`);
  console.log(`Paint: $${paintTotal.toFixed(2)} (Taylor Customs)`);
  console.log(`Interior: $${interiorTotal.toFixed(2)} (Ernies Upholstery)`);
  console.log(`Mechanical: $${items.filter(i => i.category === 'Mechanical').reduce((sum, i) => sum + (i.part_cost || 0) + (i.labor_cost || 0), 0).toFixed(2)}`);
}

function parseLineItems(lines, section) {
  const items = [];
  
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 4) continue;
    
    const category = parts[0]?.trim();
    const description = parts[1]?.trim();
    const minutes = parseFloat(parts[2]) || 0;
    const partCost = parseCurrency(parts[3]);
    const myCost = parts[4] ? parseCurrency(parts[4]) : null;
    
    // Skip summary rows
    if (!description || description.includes('Hours') || description.includes('Labor hours')) continue;
    if (description.includes('Parts') || description.includes('Cash') || description.includes('Trade')) continue;
    
    // Calculate labor
    const laborHours = minutes / 60;
    const laborCost = laborHours * LABOR_RATE;
    
    items.push({
      category: category || 'Other',
      description,
      minutes,
      labor_hours: laborHours,
      labor_cost: laborCost,
      part_cost: myCost || partCost || 0,  // Prefer "my cost" over estimate
      my_cost: myCost,
      part_replace_cost: partCost,
      notes: section
    });
  }
  
  return items;
}

function parseCurrency(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[$,]/g, '').trim();
  return cleaned ? parseFloat(cleaned) : 0;
}

main().catch(console.error);

