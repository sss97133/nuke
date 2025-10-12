import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'http://localhost:54321',
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
);

// Your ACTUAL 77 Blazer Build Log
const BUILD_DATA = `Time,,part,Supplier,investment,Done,Invoice 3,Invoice 4,total
6580m,Totals,,,$89865.33,$86940.33,$5350.00,$33550.00,$125840.33
,Payment 1 ,,,$42378.96,,,,
,Payment 2,,,$18946.37,,,,
110 hours,Payment 3,,,$28540.00,,,,
0,wheels,tires,Discount tire,,$1300.00,,,
0,wheels,wheels,Ebay - supplier,,$600.00,,,
0,wheels,Wheel powder coat,Shine shop ,,$300.00,,,
0,wheels,Mount and balance,Discount tire,,$130.00,,,
0,wheels,Lug nuts,amazon,,$80.00,,,
0,vehicle,Rolling chassis assembly,labor,,$7500.00,,,
0,vehicle,Disassembly,labor,,$2500.00,,,
0,vehicle,Intital Purchase n shipping,Ksl,,$2250.00,,,
0,vehicle,Powder COAT,Shine shop ,,$1800.00,,,
0,vehicle,Motec engine wiring m130,Desert performance,,$15000.00,,,
0,vehicle,Motec body wiring PDM,Desert performance,,,,$15000.00,
0,Transmission,6L90,Marketplace,,$1600.00,,,
30,Transmission,Torque converter bolts,summit,,$30.00,,,
60,Transmission,6l90 rife,Rife,,$500.00,,,
30,Transmission,6l90 m control,TBC,,$500.00,,,
30,Transmission,Trans fluid test,Auto specialist,,,$360.00,,
30,Transmission,Dry ice transmission,Dry ice,,,$250.00,,
90,transmission,Trans cooler,Motorsport,,,$250.00,,
30,transmission,6l90 linkage,Lokar,,,$200.00,,
90,Transmission,Trans cover,Machinist,,$200.00,,,
60,Transmission,Transmission bushings,summit,,,$120.00,,
0,Transfer case,Case rebuild,Labor,,$1200.00,,,
0,Transfer case,205 t case,Marketplace,,$1000.00,,,
0,Transfer case,Case adapt,Advance adapters,,$800.00,,,
90,Transfer case,linkage,Jb custom,,,$250.00,,
90,Transfer case,Case machine work,machinist,,$150.00,,,
0,Tax,,,,$3274.96,,,
0,Tax,,,,$1446.37,,,
0,Suspension,Lift kit,Rough country,,$800.00,,,
0,Suspension,Rear shackles,Rock auto,,$140.00,,,
0,Suspension,Steering box,Ebay - new,,$400.00,,,
0,Suspension,Front shackles,Rock auto,,$100.00,,,
60,suspension,Cross over bars,machinist,,$100.00,,,
30,suspension,Cross over drop arm,tbc,,$100.00,,,
30,suspension,Cross over ball joints,tbc,,$100.00,,,
0,suspension,Drop sway bar,Ord,,$600.00,,,
0,suspension,Gearbox support,Ord,,$150.00,,,
0,interior,Lmc order,Lmc,,$300.00,,,
0,interior,SMS fabric,Sms,,$260.00,,,
60,interior,Precision felt kit,Precision,,$150.00,,,
60,interior,Interior upholstery,labor,,$2500.00,$400.00,,
60,interior,Dash,Jegs,,,$600.00,,
60,interior,Carpet,Oc carpet,,,$455.00,,
540,interior,Dynamat,ebay,,$440.00,,,
180,interior,Seat panels refurbish,labor,,$400.00,,,
540,interior,Center console restore,labor,,$300.00,,,
180,Interior,Seat belts,marketplace,,,$250.00,,
60,interior,Vinyl fabric,Galaxy,,,$100.00,,
90,interior,Headliner material,galaxy,,,$100.00,,
15,interior,Kick plates,Cj pony,,,$100.00,,
180,Fuel delivery,Fuel line kit,Amazon,,$120.00,,,
30,Fuel delivery,Fuel line frame clips,Amazon,,$40.00,,,
90,Fuel delivery,Fuel pump sending unit,Ebay - supplier,,$400.00,,,
15,Fuel delivery,Tank fillers,Autozone,,,$110.00,,
360,Exhaust,304 stainless borla,summit,,$1500.00,,,
0,Engine,Ls3,Summit,,$6200.00,,,
90,Engine,Pulley kit,Holley,,$2000.00,,,
30,Engine,Del s3,Delmo speed,,$662.00,,,
30,Engine,Del s3,Delmo speed,,$377.00,,,
30,Engine,Intake,Ebay - holley,,$310.00,,,
30,Engine,Fuel rails,Holley,,$280.00,,,
30,Engine,Ignition coil set,Ebay - km motorsport,,$200.00,,,
30,Engine,flexplate,summit,,$110.00,,,
30,Engine,Throttle body,Ebay - supplier,,$100.00,,,
30,Engine,Spark plugs ,Ebay - supplier,,$70.00,,,
15,Engine,Flexplate bolts,summit,,$30.00,,,
30,engine,Upgraded alternator,TBC,,,$500.00,,
30,engine,Radiator,Ebay - supplier,,$500.00,,,
180,engine,Fluids,Autozone,,,$300.00,,
15,engine,starter,Ebay - supplier,,$250.00,,,
90,engine,Oil cooler,Motorsport,,,$250.00,,
15,engine,Radiator steam hoses,Ebay - supplier,,$150.00,,,
30,engine,Fittings for engine coolant,tbc,,,$100.00,,
30,Engine,Radiator overflow,Cj pony,,$100.00,,,
180,Brakes,Tesla brake booster,Ebay - supplier,,$300.00,,,
90,Brakes,Brake line kit,Inline tube,,$250.00,,,
15,brakes,Brake proportioning valve,Ebay - inline tube,,$60.00,,,
180,brakes,E brake assembly,Tbc,,,$300.00,,
30,brakes,Billet adapter,machinist,,,$200.00,,
30,Brakes,booster angle bracket,holley,,,$75.00,,
30,brake,Brake pads front,Autozone,,,$80.00,,
0,Body,Rocker panel repairs,labor,,$1700.00,,,
0,Body,Trim polish,Shine shop ,,$800.00,,,
0,Body,Rust repair,labor,,$750.00,,,
0,Body,Raptor liner,Cti,,$520.00,,,
0,Body,fasteners,amazon,,$500.00,,,
0,Body,Dent pull,Dent man,,$300.00,,,
0,Body,Body mounts,Ebay - supplier,,$175.00,,,
0,Body,fasteners,True value,,$120.00,,,
0,Body,Radiator support rubber kit,Ebay - supplier,,$70.00,,,
60,Body,metallic red,Cti,,$600.00,,,
30,Body,Rad support,Cj pony,,$320.00,,,
560,Body,Clear coat,Cti,,$300.00,,,
15,Body,front bumper,Cj pony,,,,$250.00,
15,Body,Rear bumper,Cj pony,,,,$250.00,
180,body,Owner badge,machinist,,,,$250.00,
60,body,Redrobright led,holley,,,,$600.00,
90,Body,windshield,Acme,,,,$300.00,
30,Body,Side mirrors,Cj pony,,,,$100.00,
30,Body,Hood hinges,Cj pony,,,,$100.00,
60,Body,Windshield trim + rubber,Precision,,,,$80.00,
30,Body,Bumper bolts,Cj pony,,,,$60.00,
10,body,Hood heat shield,Amazon,,,,$50.00,
90,Body,Under carriage repaint,labor,,$250.00,,,
0,body,Paint work round 1,labor,,$5000.00,,,
0,body,Paint work round 2,labor,,$5000.00,,,
0,Axles,Rear axle rebuild,Labor,,$1500.00,,,
0,Axles,Front axle rebuild,Labor,,$1500.00,,,
0,Axles,Rear Disc brake kit,Ebay - supplier,,$600.00,,,
0,Axles,Cross over steering,Ebay - supplier,,$425.00,,,
90,Axles,rear Driveshaft,Adams driveline,,,,$500.00,
90,axles,Front driveshaft,Adams driveline,,,,$500.00,
0,assembly,110 hours,Labor,,,,$13750.00,
160,Ac,Compressor,Ebay - supplier,,,,$500.00,
30,Ac,Condenser,Lmc,,,,$300.00,
30,Ac,Blower motor ,Ebay,,,,$300.00,
180,Ac,Ac lines,Custom,,,,$250.00,
60,Ac,Evaporator,lmc,,,,$110.00,
30,Ac,ACCUMULATOR,Lmc,,,,$100.00,
30,Ac,ADDITIONAL AC parts,tbc,,,,$100.00,
30,Ac,brackets,Machinist,,,,$100.00,
0,body,Installation,Labor - joey,,$1000.00,,,
0,body,paint,Labor - Tommy,,$2500.00,,,`;

async function importActualBuild() {
  try {
    console.log('Importing your actual Blazer build data...');
    
    // Parse CSV
    const lines = BUILD_DATA.split('\n');
    const headers = lines[0].split(',');
    
    // Get or create vehicle
    await supabase.from('vehicles').upsert({
      id: 'e08bf694-970f-4cbe-8a74-8715158a0f2e',
      year: 1977,
      make: 'Chevrolet',
      model: 'Blazer K5',
      user_id: (await supabase.auth.getUser()).data?.user?.id
    }, { onConflict: 'id' });
    
    // Delete existing builds to start fresh
    await supabase
      .from('vehicle_builds')
      .delete()
      .eq('vehicle_id', 'e08bf694-970f-4cbe-8a74-8715158a0f2e');
    
    // Create the main build
    const { data: build } = await supabase
      .from('vehicle_builds')
      .insert({
        vehicle_id: 'e08bf694-970f-4cbe-8a74-8715158a0f2e',
        name: '1977 Blazer K5 - Complete Restoration',
        description: 'Frame-off restoration with LS3 swap, 6L90 transmission, Motec M130 ECU',
        status: 'in_progress',
        total_budget: 150000,
        total_spent: 125840.33,
        total_hours_actual: 110,
        start_date: '2023-01-01'
      })
      .select()
      .single();
      
    if (!build) {
      console.error('Failed to create build');
      return;
    }
    
    console.log('Created build:', build.id);
    
    // Parse all line items
    const lineItems = [];
    
    for (let i = 3; i < lines.length; i++) { // Skip totals and payment lines
      const line = lines[i];
      if (!line.trim()) continue;
      
      const parts = line.split(',');
      if (parts.length < 9) continue;
      
      const time = parts[0];
      const category = parts[1];
      const partName = parts[2];
      const supplier = parts[3];
      const investment = parseFloat(parts[4]?.replace('$', '') || '0');
      const done = parseFloat(parts[5]?.replace('$', '') || '0');
      const invoice3 = parseFloat(parts[6]?.replace('$', '') || '0');
      const invoice4 = parseFloat(parts[7]?.replace('$', '') || '0');
      
      // Skip payment/tax lines
      if (!partName || partName.includes('Payment') || category === 'Tax') continue;
      
      // Determine which phase this belongs to
      let phaseNumber = 1;
      let price = investment;
      let status = 'completed';
      
      if (done > 0) {
        phaseNumber = 2;
        price = done;
        status = 'completed';
      } else if (invoice3 > 0) {
        phaseNumber = 3;
        price = invoice3;
        status = 'ordered';
      } else if (invoice4 > 0) {
        phaseNumber = 4;
        price = invoice4;
        status = 'planning';
      }
      
      // Parse time to hours
      let hours = 0;
      if (time) {
        if (time.includes('m')) {
          hours = parseInt(time) / 60;
        } else if (time.includes('hours')) {
          hours = parseInt(time);
        } else {
          hours = parseInt(time) / 60; // Assume minutes
        }
      }
      
      lineItems.push({
        build_id: build.id,
        name: partName.trim(),
        category_name: category.trim(),
        supplier_name: supplier.trim(),
        quantity: 1,
        unit_price: price,
        total_price: price,
        status: status,
        days_to_install: Math.ceil(hours / 8), // Convert hours to days
        condition: 'new'
      });
    }
    
    // Insert all line items
    console.log(`Inserting ${lineItems.length} line items...`);
    
    // Insert in batches of 50
    for (let i = 0; i < lineItems.length; i += 50) {
      const batch = lineItems.slice(i, i + 50);
      const { error } = await supabase
        .from('build_line_items')
        .insert(batch);
        
      if (error) {
        console.error('Error inserting batch:', error);
      }
    }
    
    // Calculate totals
    const investment = lineItems.filter(i => i.unit_price > 0).reduce((sum, i) => sum + i.unit_price, 0);
    
    console.log('✅ Import complete!');
    console.log(`- Total line items: ${lineItems.length}`);
    console.log(`- Total investment: $${investment.toLocaleString()}`);
    console.log('- Categories:', [...new Set(lineItems.map(i => i.category_name))].join(', '));
    console.log('- Key items:');
    console.log('  • LS3 Engine: $6,200');
    console.log('  • 6L90 Transmission: $1,600');
    console.log('  • Motec M130 ECU: $15,000');
    console.log('  • Paint work: $10,000+');
    
  } catch (error) {
    console.error('Import error:', error);
  }
}

// Run the import
importActualBuild();
