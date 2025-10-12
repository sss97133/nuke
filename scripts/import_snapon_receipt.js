#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Your Snap-on tools from the receipt
const tools = [
  { part: 'CTB185', desc: '18V 5AH LI BATTRY W/SIDE LATCH', price: 198.95, date: '2024-04-01', serial: 'S223900219' },
  { part: 'CT9080HVDB', desc: '18v 1/2" IMPACT WR DB - HVZ', price: 622.95, date: '2024-04-01', serial: '2305090173' },
  { part: 'FR80', desc: '3/8DR 80T STD Q/R RAT', price: 125.50, date: '2024-10-07' },
  { part: 'OXKR707', desc: '7PC SHORT SAE RAT COMWRSET', price: 353.25, date: '2024-05-23' },
  { part: 'CTR867MBDB', desc: '14.4 V 3/8 LNCK RATCHET DB MB', price: 454.95, date: '2023-11-27', serial: '2313116901' },
  { part: 'CTB8174', desc: '14.4v 2.5 Ahr BATTERY BLACK', price: 97.95, date: '2024-06-03', serial: 'H234317039' },
  { part: '345SIMYFR', desc: '1/2DR 45PC IMP SAE SOCKET FSET', price: 976.00, date: '2025-02-17' },
  { part: '239SIMFYFR', desc: '3/8DR 39PC 6PT SAE IMP SKTSET', price: 560.00, date: '2025-09-08' },
  { part: '257SIMFMYFR', desc: '3/8DR 57PC 6PT MET IMP SKTSET', price: 677.00, date: '2025-09-08' },
  { part: '214IPFMFR', desc: '3/8DR 14PC IMP MET SWIVEL FSET', price: 498.96, date: '2025-09-08' },
  { part: '207IPFFR', desc: '3/8DR 7PC IMP SAE SWIVEL FSET', price: 325.33, date: '2025-09-08' },
  { part: 'CTB8174', desc: '14.4v 2.5 Ahr BATTERY BLACK', price: 116.95, date: '2023-06-12', serial: 'S224200024' },
  { part: 'CGG861DB', desc: '14.4V GREASE GUN DB', price: 399.95, date: '2024-09-09', serial: '24200488' },
  { part: 'CT825HVDB', desc: '14.4V 1/4 IMPACT WR DB HV', price: 342.95, date: '2024-06-10', serial: '2402001124' },
  { part: 'CT861GMW2', desc: '14.4V 3/8 IMP WR DB 2BAT GNMTL', price: 535.95, date: '2024-02-19', serial: '231303499/S224818260/S224817987' },
  { part: 'ASDD103HV', desc: 'TRIM PAD REMOVER SET HI-VIZ', price: 133.75, date: '2024-02-19' },
  { part: 'EECT400R', desc: '12VDC LCD CIRCUIT TESTER RED', price: 115.00, date: '2025-01-27' },
  { part: 'EEPV500', desc: 'AUTOMOTIVE COMPRESSION SET', price: 200.00, date: '2025-01-27' },
  { part: 'EEDM15APD', desc: '15A PARASITIC DRAW TESTHARNESS', price: 66.50, date: '2024-05-13' },
  { part: 'EEDM504F', desc: 'BASIC MULTIMETER TRMS-DAYLIGHT', price: 343.00, date: '2023-05-08', serial: '22470769' },
  // Add more tools as needed...
];

async function importTools() {
  try {
    console.log('Starting Snap-on tool import...');
    
    // Get or create Snap-on brand
    let { data: brand } = await supabase
      .from('tool_brands')
      .select('id')
      .eq('name', 'Snap-on')
      .single();
    
    if (!brand) {
      const { data: newBrand } = await supabase
        .from('tool_brands')
        .insert({
          name: 'Snap-on',
          website: 'https://shop.snapon.com'
        })
        .select()
        .single();
      brand = newBrand;
    }
    
    console.log('Using brand ID:', brand.id);
    
    // Import each tool
    for (const tool of tools) {
      try {
        // Check or create catalog entry
        let { data: catalogItem } = await supabase
          .from('tool_catalog')
          .select('id')
          .eq('brand_id', brand.id)
          .eq('part_number', tool.part)
          .single();
        
        if (!catalogItem) {
          const { data: newItem } = await supabase
            .from('tool_catalog')
            .insert({
              brand_id: brand.id,
              part_number: tool.part,
              description: tool.desc,
              list_price: tool.price,
              product_url: `https://shop.snapon.com/product/${tool.part}`,
              category: categorizeToolByDescription(tool.desc)
            })
            .select()
            .single();
          catalogItem = newItem;
          console.log(`Added to catalog: ${tool.part} - ${tool.desc}`);
        }
        
        // Add to your inventory (replace with your actual user ID)
        const userId = 'YOUR_USER_ID'; // You'll need to set this
        
        const { data: userTool } = await supabase
          .from('user_tools')
          .insert({
            user_id: userId,
            catalog_id: catalogItem.id,
            transaction_date: tool.date,
            purchase_price: tool.price,
            serial_number: tool.serial,
            condition: 'excellent',
            verified_by_operator: true
          })
          .select()
          .single();
        
        console.log(`Added to inventory: ${tool.part}`);
      } catch (error) {
        console.error(`Error importing ${tool.part}:`, error.message);
      }
    }
    
    console.log('Import complete!');
  } catch (error) {
    console.error('Import failed:', error);
  }
}

function categorizeToolByDescription(description) {
  const desc = description.toLowerCase();
  
  if (desc.includes('socket') || desc.includes('skt')) return 'Sockets';
  if (desc.includes('wrench') || desc.includes('wrnch')) return 'Wrenches';
  if (desc.includes('ratchet') || desc.includes('rat')) return 'Ratchets';
  if (desc.includes('impact')) return 'Power Tools';
  if (desc.includes('grease gun')) return 'Power Tools';
  if (desc.includes('battery')) return 'Batteries';
  if (desc.includes('tester') || desc.includes('meter')) return 'Electrical';
  if (desc.includes('compression')) return 'Specialty';
  
  return 'Misc Tools';
}

// Run the import
importTools();
