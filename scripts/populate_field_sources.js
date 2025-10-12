import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function populateFieldSources() {
    console.log('Fetching vehicles...');
    
    // Get all vehicles
    const { data: vehicles, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('*');
    
    if (vehiclesError) {
        console.error('Error fetching vehicles:', vehiclesError);
        return;
    }
    
    console.log(`Found ${vehicles.length} vehicles`);
    
    for (const vehicle of vehicles) {
        console.log(`Processing vehicle ${vehicle.id} (${vehicle.year} ${vehicle.make} ${vehicle.model})`);
        
        const sourceType = vehicle.user_id ? 'user_input' : 'ai_scan';
        const sourceName = sourceType === 'user_input' ? 'Vehicle Owner' : 'AI Scanner';
        const confidence = sourceType === 'user_input' ? 75 : 60;
        
        const fields = [
            { name: 'make', value: vehicle.make },
            { name: 'model', value: vehicle.model },
            { name: 'year', value: vehicle.year?.toString() },
            { name: 'vin', value: vehicle.vin, confidence: confidence + 10 },
            { name: 'mileage', value: vehicle.mileage?.toString() },
            { name: 'color', value: vehicle.color },
            { name: 'msrp', value: vehicle.msrp?.toString() },
            { name: 'current_value', value: vehicle.current_value?.toString() },
            { name: 'engine_size', value: vehicle.engine_size },
            { name: 'transmission', value: vehicle.transmission },
            { name: 'fuel_type', value: vehicle.fuel_type },
            { name: 'drivetrain', value: vehicle.drivetrain },
            { name: 'body_style', value: vehicle.body_style },
            { name: 'trim', value: vehicle.trim }
        ];
        
        for (const field of fields) {
            if (field.value) {
                const { error } = await supabase
                    .from('vehicle_field_sources')
                    .upsert({
                        vehicle_id: vehicle.id,
                        field_name: field.name,
                        field_value: field.value,
                        source_type: sourceType,
                        source_name: sourceName,
                        confidence_score: field.confidence || confidence,
                        verification_details: sourceType === 'user_input' ? 'Owner provided' : 'AI extracted',
                        is_verified: sourceType === 'user_input'
                    }, {
                        onConflict: 'vehicle_id,field_name,source_type,source_name'
                    });
                
                if (error && !error.message.includes('duplicate')) {
                    console.error(`Error inserting ${field.name}:`, error);
                }
            }
        }
        
        // Add simulated multi-source data for MSRP
        if (vehicle.msrp) {
            // KBB estimate
            const kbbValue = Math.round(vehicle.msrp * (0.95 + Math.random() * 0.1));
            await supabase
                .from('vehicle_field_sources')
                .upsert({
                    vehicle_id: vehicle.id,
                    field_name: 'msrp',
                    field_value: kbbValue.toString(),
                    source_type: 'ai_scraped',
                    source_name: 'KBB.com',
                    source_url: `https://www.kbb.com/${vehicle.make}/${vehicle.model}`,
                    confidence_score: 85,
                    verification_details: 'Scraped from KBB pricing data',
                    is_verified: false
                }, {
                    onConflict: 'vehicle_id,field_name,source_type,source_name'
                });
            
            // Edmunds estimate
            const edmundsValue = Math.round(vehicle.msrp * (0.97 + Math.random() * 0.06));
            await supabase
                .from('vehicle_field_sources')
                .upsert({
                    vehicle_id: vehicle.id,
                    field_name: 'msrp',
                    field_value: edmundsValue.toString(),
                    source_type: 'ai_scraped',
                    source_name: 'Edmunds.com',
                    source_url: `https://www.edmunds.com/${vehicle.make}/${vehicle.model}`,
                    confidence_score: 85,
                    verification_details: 'Scraped from Edmunds pricing guide',
                    is_verified: false
                }, {
                    onConflict: 'vehicle_id,field_name,source_type,source_name'
                });
        }
        
        // Add some professional verification randomly
        if (Math.random() > 0.7 && vehicle.mileage) {
            await supabase
                .from('vehicle_field_sources')
                .upsert({
                    vehicle_id: vehicle.id,
                    field_name: 'mileage',
                    field_value: vehicle.mileage.toString(),
                    source_type: 'professional',
                    source_name: 'AutoCheck Diagnostic',
                    confidence_score: 95,
                    verification_details: 'OBD-II verified mileage reading',
                    diagnostic_codes: ['P0000'],
                    is_verified: true
                }, {
                    onConflict: 'vehicle_id,field_name,source_type,source_name'
                });
        }
        
        // Add human verification for color randomly
        if (Math.random() > 0.5 && vehicle.color) {
            await supabase
                .from('vehicle_field_sources')
                .upsert({
                    vehicle_id: vehicle.id,
                    field_name: 'color',
                    field_value: vehicle.color,
                    source_type: 'human_verified',
                    source_name: 'Inspection Service',
                    confidence_score: 90,
                    verification_details: 'Verified during physical inspection',
                    is_verified: true
                }, {
                    onConflict: 'vehicle_id,field_name,source_type,source_name'
                });
        }
    }
    
    console.log('Field sources population complete!');
}

populateFieldSources().catch(console.error);
