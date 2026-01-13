require('dotenv').config({ path: '.env.local' });

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';

async function analyzeVehicleDataQuality() {
  console.log('🔍 VEHICLE DATA QUALITY ANALYSIS');
  console.log('=' .repeat(60));

  try {
    // Get sample of vehicles to analyze structure
    const sampleResponse = await fetch(`${supabaseUrl}/rest/v1/vehicles?limit=100&order=created_at.desc`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    const vehicles = await sampleResponse.json();
    console.log(`\n📊 Analyzing ${vehicles.length} sample vehicles...\n`);

    // Track data quality issues
    const issues = {
      missingVIN: 0,
      invalidVIN: 0,
      missingMake: 0,
      missingModel: 0,
      missingYear: 0,
      missingImages: 0,
      duplicateVINs: new Set(),
      invalidYears: 0,
      missingPrice: 0,
      missingMileage: 0,
      missingLocation: 0,
      missingDescription: 0
    };

    // Analyze each vehicle
    vehicles.forEach(vehicle => {
      // Check VIN
      if (!vehicle.vin) {
        issues.missingVIN++;
      } else if (vehicle.vin.length !== 17) {
        issues.invalidVIN++;
      }

      // Check basic fields
      if (!vehicle.make) issues.missingMake++;
      if (!vehicle.model) issues.missingModel++;
      if (!vehicle.year) issues.missingYear++;
      if (!vehicle.price || vehicle.price === 0) issues.missingPrice++;
      if (!vehicle.mileage) issues.missingMileage++;
      if (!vehicle.location && !vehicle.city && !vehicle.state) issues.missingLocation++;
      if (!vehicle.description) issues.missingDescription++;

      // Check year validity
      const currentYear = new Date().getFullYear();
      if (vehicle.year && (vehicle.year < 1900 || vehicle.year > currentYear + 2)) {
        issues.invalidYears++;
      }
    });

    // Check for duplicate VINs
    const vinCounts = {};
    vehicles.forEach(v => {
      if (v.vin) {
        vinCounts[v.vin] = (vinCounts[v.vin] || 0) + 1;
      }
    });

    Object.entries(vinCounts).forEach(([vin, count]) => {
      if (count > 1) {
        issues.duplicateVINs.add(vin);
      }
    });

    // Print quality report
    console.log('🚨 DATA QUALITY ISSUES FOUND:');
    console.log('=' .repeat(60));
    console.log(`Missing VINs:        ${issues.missingVIN} (${(issues.missingVIN / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Invalid VINs:        ${issues.invalidVIN} (${(issues.invalidVIN / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Missing Make:        ${issues.missingMake} (${(issues.missingMake / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Missing Model:       ${issues.missingModel} (${(issues.missingModel / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Missing Year:        ${issues.missingYear} (${(issues.missingYear / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Invalid Years:       ${issues.invalidYears} (${(issues.invalidYears / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Missing Price:       ${issues.missingPrice} (${(issues.missingPrice / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Missing Mileage:     ${issues.missingMileage} (${(issues.missingMileage / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Missing Location:    ${issues.missingLocation} (${(issues.missingLocation / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Missing Description: ${issues.missingDescription} (${(issues.missingDescription / vehicles.length * 100).toFixed(1)}%)`);
    console.log(`Duplicate VINs:      ${issues.duplicateVINs.size} unique VINs with duplicates`);

    // Get field completeness
    console.log('\n📊 FIELD POPULATION ANALYSIS:');
    console.log('=' .repeat(60));

    const fields = Object.keys(vehicles[0] || {});
    const fieldCompleteness = {};

    fields.forEach(field => {
      const populated = vehicles.filter(v => v[field] !== null && v[field] !== '' && v[field] !== undefined).length;
      fieldCompleteness[field] = (populated / vehicles.length * 100).toFixed(1);
    });

    // Sort by completeness
    const sorted = Object.entries(fieldCompleteness).sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));

    sorted.forEach(([field, percent]) => {
      const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
      console.log(`${field.padEnd(25)} ${bar} ${percent}%`);
    });

    // Check images count
    const imageResponse = await fetch(`${supabaseUrl}/rest/v1/vehicle_images?select=vehicle_id`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    const images = await imageResponse.json();
    const vehicleImageCounts = {};
    images.forEach(img => {
      vehicleImageCounts[img.vehicle_id] = (vehicleImageCounts[img.vehicle_id] || 0) + 1;
    });

    console.log('\n📷 IMAGE COVERAGE:');
    console.log('=' .repeat(60));
    console.log(`Total images: ${images.length}`);
    console.log(`Vehicles with images: ${Object.keys(vehicleImageCounts).length}`);
    console.log(`Average images per vehicle: ${(images.length / Object.keys(vehicleImageCounts).length).toFixed(1)}`);

  } catch (error) {
    console.error('Error analyzing data:', error);
  }
}

analyzeVehicleDataQuality().catch(console.error);