import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function setupTestData() {
  console.log('Setting up test data...');
  
  // First, we need to authenticate as a user
  console.log('Please sign in first to create test data for your account.');
  console.log('You can use the following test credentials or your own:');
  console.log('Email: test@example.com');
  console.log('Password: testpass123');
  
  // Attempt to sign in with test account
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'test@example.com',
    password: 'testpass123'
  });
  
  if (authError) {
    console.log('Could not sign in with test account:', authError.message);
    console.log('Please ensure you have a user account and update the credentials in this script.');
    return;
  }
  
  console.log('✅ Signed in successfully');
  const userId = authData.user.id;
  
  // Check if profile exists
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (profileError) {
    console.log('Profile not found, creating one...');
    const { error: createError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        email: authData.user.email,
        display_name: 'Test User',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    
    if (createError) {
      console.error('Error creating profile:', createError);
      return;
    }
    console.log('✅ Profile created');
  } else {
    console.log('✅ Profile exists');
  }
  
  // Create test vehicles
  const testVehicles = [
    {
      user_id: userId,
      make: 'Porsche',
      model: '911',
      sub_model: 'Carrera',
      year: 2023,
      vin: 'WP0AA2A92PS123456',
      color: 'Guards Red',
      mileage: 5000,
      ownership_type: 'owner',
      ownership_percentage: 100,
      current_value: 120000,
      description: 'Test Porsche 911 - Beautiful Guards Red example',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      user_id: userId,
      make: 'BMW',
      model: 'M3',
      sub_model: 'Competition',
      year: 2022,
      vin: 'WBS53AY09PCH12345',
      color: 'Isle of Man Green',
      mileage: 12000,
      ownership_type: 'owner',
      ownership_percentage: 100,
      current_value: 85000,
      description: 'Test BMW M3 - Track-ready Competition package',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      user_id: userId,
      make: 'Ferrari',
      model: '458',
      sub_model: 'Italia',
      year: 2014,
      vin: 'ZFF67NFA8E0123456',
      color: 'Rosso Corsa',
      mileage: 8500,
      ownership_type: 'owner',
      ownership_percentage: 100,
      current_value: 250000,
      description: 'Test Ferrari 458 - Classic Italian supercar',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];
  
  console.log('Creating test vehicles...');
  
  for (const vehicle of testVehicles) {
    const { data, error } = await supabase
      .from('vehicles')
      .insert(vehicle)
      .select()
      .single();
    
    if (error) {
      console.error(`Error creating ${vehicle.make} ${vehicle.model}:`, error.message);
    } else {
      console.log(`✅ Created ${vehicle.make} ${vehicle.model} (ID: ${data.id})`);
      
      // Create a timeline event for each vehicle
      const { error: eventError } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: data.id,
          user_id: userId,
          event_type: 'creation',
          event_date: new Date().toISOString(),
          title: 'Vehicle Added',
          description: `Added ${vehicle.year} ${vehicle.make} ${vehicle.model} to collection`,
          metadata: {
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year
          }
        });
      
      if (eventError) {
        console.error('Error creating timeline event:', eventError.message);
      } else {
        console.log(`  ✅ Created timeline event`);
      }
    }
  }
  
  console.log('\n✅ Test data setup complete!');
  console.log('You can now log in to the app with:');
  console.log('Email: test@example.com');
  console.log('Password: testpass123');
}

setupTestData().catch(console.error);
