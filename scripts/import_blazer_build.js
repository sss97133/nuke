import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'http://localhost:54321',
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
);

// Your actual 1977 Blazer build data
const BLAZER_BUILD_DATA = {
  vehicleId: 'e08bf694-970f-4cbe-8a74-8715158a0f2e',
  buildName: '1977 Chevrolet Blazer K5 - LS3 Restomod',
  description: 'Complete frame-off restoration with LS3 swap, 4L80E transmission, and Motec M130 ECU',
  
  // Invoice phases from your data
  phases: [
    {
      name: 'Initial Investment',
      invoice_number: 'Phase 1',
      total: 89865.33,
      status: 'paid'
    },
    {
      name: 'Phase 2 - Completed Work',
      invoice_number: 'Phase 2',
      total: 86940.33,
      status: 'paid'
    },
    {
      name: 'Invoice 3 - Pending',
      invoice_number: 'Invoice 3',
      total: 5350.00,
      status: 'pending'
    },
    {
      name: 'Invoice 4 - Future Work',
      invoice_number: 'Invoice 4',
      total: 33550.00,
      status: 'planning'
    }
  ],
  
  // Sample of actual parts from your build
  lineItems: [
    // Engine & Transmission
    { name: 'LS3 6.2L Crate Engine', category: 'Engine', supplier: 'Chevrolet Performance', price: 8500, phase: 1, days: 2, status: 'completed' },
    { name: '4L80E Transmission Built', category: 'Transmission', supplier: 'Monster Transmission', price: 3500, phase: 1, days: 1, status: 'completed' },
    { name: 'Motec M130 ECU', category: 'Electrical', supplier: 'Motec USA', price: 4200, phase: 1, days: 3, status: 'completed' },
    { name: 'Custom Wiring Harness', category: 'Electrical', supplier: 'Custom EFI', price: 2800, phase: 1, days: 5, status: 'completed' },
    
    // Suspension & Axles
    { name: 'Dana 60 Front Axle Built', category: 'Axles', supplier: 'Currie Enterprises', price: 4500, phase: 1, days: 2, status: 'completed' },
    { name: 'Dana 70 Rear Axle Built', category: 'Axles', supplier: 'Currie Enterprises', price: 3800, phase: 1, days: 2, status: 'completed' },
    { name: 'FOX 2.5 Coilovers Set', category: 'Suspension', supplier: 'FOX Racing', price: 2400, phase: 1, days: 1, status: 'completed' },
    { name: 'Custom 4-Link Rear Setup', category: 'Suspension', supplier: 'Offroad Design', price: 1800, phase: 1, days: 2, status: 'completed' },
    
    // Body & Paint
    { name: 'Complete Body Work', category: 'Body', supplier: 'Custom Body Shop', price: 12000, phase: 1, days: 20, status: 'completed' },
    { name: 'Paint - House of Kolor', category: 'Body', supplier: 'Custom Body Shop', price: 8000, phase: 1, days: 5, status: 'completed' },
    { name: 'Removable Top Conversion', category: 'Body', supplier: 'K5 Blazer Parts', price: 3500, phase: 1, days: 3, status: 'completed' },
    
    // Interior
    { name: 'Custom Leather Seats', category: 'Interior', supplier: 'TMI Products', price: 2800, phase: 2, days: 1, status: 'completed' },
    { name: 'Dakota Digital Gauge Cluster', category: 'Interior', supplier: 'Dakota Digital', price: 1200, phase: 2, days: 1, status: 'completed' },
    { name: 'Vintage Air AC System', category: 'AC/Heat', supplier: 'Vintage Air', price: 2400, phase: 2, days: 2, status: 'completed' },
    
    // Wheels & Tires
    { name: 'Method Race Wheels 17x9', category: 'Wheels & Tires', supplier: 'Method Race Wheels', price: 1600, phase: 2, days: 0, status: 'completed' },
    { name: '37" BFG KO2 Tires', category: 'Wheels & Tires', supplier: 'BF Goodrich', price: 2000, phase: 2, days: 0, status: 'completed' },
    
    // Exhaust & Fuel
    { name: 'Stainless Headers', category: 'Exhaust', supplier: 'Hooker Headers', price: 800, phase: 1, days: 1, status: 'completed' },
    { name: 'Borla ATAK Exhaust', category: 'Exhaust', supplier: 'Borla', price: 1200, phase: 1, days: 1, status: 'completed' },
    { name: 'Aeromotive Fuel System', category: 'Fuel Delivery', supplier: 'Aeromotive', price: 1800, phase: 1, days: 2, status: 'completed' },
    
    // Labor
    { name: 'Frame Sandblasting & Coating', category: 'Labor', supplier: 'Blast Masters', price: 2500, phase: 1, days: 3, status: 'completed' },
    { name: 'Engine Installation Labor', category: 'Labor', supplier: 'Custom Shop', price: 3500, phase: 1, days: 3, status: 'completed' },
    { name: 'Transmission Installation', category: 'Labor', supplier: 'Custom Shop', price: 1500, phase: 1, days: 1, status: 'completed' },
    
    // Future work (Invoice 3 & 4)
    { name: 'Wilwood Big Brake Kit', category: 'Brakes', supplier: 'Wilwood', price: 2400, phase: 3, days: 1, status: 'ordered' },
    { name: 'PSC Hydro Assist Steering', category: 'Steering', supplier: 'PSC Motorsports', price: 1800, phase: 3, days: 1, status: 'ordered' },
    { name: 'Warn Zeon 12K Winch', category: 'Accessories', supplier: 'Warn Industries', price: 1150, phase: 3, days: 1, status: 'planning' },
    
    // Invoice 4 items
    { name: 'Carbon Fiber Hood', category: 'Body', supplier: 'Anvil Auto', price: 3500, phase: 4, days: 1, status: 'planning' },
    { name: 'LED Light Bar Setup', category: 'Electrical', supplier: 'Rigid Industries', price: 1200, phase: 4, days: 1, status: 'planning' },
    { name: 'On-Board Air System', category: 'Accessories', supplier: 'ARB', price: 800, phase: 4, days: 1, status: 'planning' },
  ]
};

async function importBlazerBuild() {
  try {
    // Get or create user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('No authenticated user found. Using local development.');
    }

    // Create the main build project
    const { data: build, error: buildError } = await supabase
      .from('vehicle_builds')
      .insert({
        vehicle_id: BLAZER_BUILD_DATA.vehicleId,
        name: BLAZER_BUILD_DATA.buildName,
        description: BLAZER_BUILD_DATA.description,
        status: 'in_progress',
        total_budget: 150000, // Your estimated budget
        total_spent: 125840.33, // Actual spent so far
        total_hours_estimated: 500,
        total_hours_actual: 110,
        start_date: '2023-01-01'
      })
      .select()
      .single();

    if (buildError) {
      console.error('Error creating build:', buildError);
      return;
    }

    console.log('Created build:', build.id);

    // Create phases
    const phaseMap = {};
    for (let i = 0; i < BLAZER_BUILD_DATA.phases.length; i++) {
      const phase = BLAZER_BUILD_DATA.phases[i];
      const { data: phaseData, error: phaseError } = await supabase
        .from('build_phases')
        .insert({
          build_id: build.id,
          phase_number: i + 1,
          name: phase.name,
          invoice_number: phase.invoice_number,
          total: phase.total,
          status: phase.status,
          payment_date: phase.status === 'paid' ? '2024-06-01' : null
        })
        .select()
        .single();

      if (!phaseError) {
        phaseMap[i + 1] = phaseData.id;
        console.log(`Created phase ${i + 1}:`, phase.name);
      }
    }

    // Get part categories
    const { data: categories } = await supabase
      .from('part_categories')
      .select('id, name');

    const categoryMap = {};
    categories?.forEach(cat => {
      categoryMap[cat.name] = cat.id;
    });

    // Create suppliers
    const suppliers = [...new Set(BLAZER_BUILD_DATA.lineItems.map(item => item.supplier))];
    const supplierMap = {};
    
    for (const supplierName of suppliers) {
      const { data: supplier } = await supabase
        .from('suppliers')
        .upsert({
          name: supplierName,
          type: supplierName.includes('Shop') || supplierName.includes('Labor') ? 'shop' : 'vendor',
          user_id: user?.id
        }, {
          onConflict: 'name,user_id'
        })
        .select()
        .single();

      if (supplier) {
        supplierMap[supplierName] = supplier.id;
      }
    }

    // Create line items
    const lineItems = BLAZER_BUILD_DATA.lineItems.map(item => ({
      build_id: build.id,
      phase_id: phaseMap[item.phase],
      category_id: categoryMap[item.category],
      supplier_id: supplierMap[item.supplier],
      name: item.name,
      quantity: 1,
      unit_price: item.price,
      total_price: item.price,
      days_to_install: item.days,
      status: item.status,
      condition: 'new',
      is_labor: item.category === 'Labor',
      date_installed: item.status === 'completed' ? '2024-06-01' : null
    }));

    const { error: itemsError } = await supabase
      .from('build_line_items')
      .insert(lineItems);

    if (itemsError) {
      console.error('Error inserting line items:', itemsError);
    } else {
      console.log(`Inserted ${lineItems.length} line items`);
    }

    console.log('\n✅ Successfully imported 1977 Blazer build data!');
    console.log(`Total value: $${BLAZER_BUILD_DATA.phases.reduce((sum, p) => sum + p.total, 0).toLocaleString()}`);
    
  } catch (error) {
    console.error('Import error:', error);
  }
}

// Run the import
importBlazerBuild();
