require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase configuration - using the same values from the frontend
const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU5NDQ0MDksImV4cCI6MjA1MTUyMDQwOX0.nGaEqGUHOFWGgF3dBRBhOGWgJjKAYGpGxJgKqJQSqHs';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Sample vehicle data
const sampleVehicles = [
  {
    make: 'Lexus',
    model: 'LX450',
    year: 1997,
    color: 'White',
    mileage: 185000,
    vin: 'JT6HJ88J1V0123456',
    description: 'Classic Toyota Land Cruiser in Lexus trim'
  },
  {
    make: 'Toyota',
    model: 'Land Cruiser',
    year: 1995,
    color: 'Green',
    mileage: 220000,
    vin: 'JT3HJ85J2S0234567',
    description: 'Bulletproof FZJ80 Land Cruiser'
  },
  {
    make: 'BMW',
    model: 'M3',
    year: 2001,
    color: 'Silver',
    mileage: 95000,
    vin: 'WBSBG93441PY345678',
    description: 'E46 M3 in excellent condition'
  },
  {
    make: 'Porsche',
    model: '911',
    year: 1989,
    color: 'Red',
    mileage: 78000,
    vin: 'WP0AB0918KS456789',
    description: 'Classic 964 Carrera'
  },
  {
    make: 'Ford',
    model: 'Bronco',
    year: 1996,
    color: 'Blue',
    mileage: 165000,
    vin: '1FMEU15N6TLA567890',
    description: 'Full-size Bronco, last of its kind'
  }
];

// Sample user profiles
const sampleProfiles = [
  {
    username: 'skylar_garage',
    avatar_url: null
  },
  {
    username: 'classic_collector',
    avatar_url: null
  },
  {
    username: 'off_road_king',
    avatar_url: null
  },
  {
    username: 'track_day_bro',
    avatar_url: null
  },
  {
    username: 'vintage_hunter',
    avatar_url: null
  }
];

async function populateDiscoveryFeed() {
  console.log('Starting to populate Discovery feed...');
  
  try {
    // First, create sample user profiles
    console.log('Creating sample profiles...');
    const profilePromises = sampleProfiles.map(async (profile, index) => {
      // Create a fake user ID for each profile
      const fakeUserId = `user_${index + 1}_${Date.now()}`;
      
      const { data, error } = await supabase
        .from('profiles')
        .insert({
          id: fakeUserId,
          username: profile.username,
          avatar_url: profile.avatar_url,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
        
      if (error) {
        console.error(`Error creating profile ${profile.username}:`, error);
        return null;
      }
      
      return data;
    });
    
    const createdProfiles = await Promise.all(profilePromises);
    const validProfiles = createdProfiles.filter(p => p !== null);
    
    console.log(`Created ${validProfiles.length} profiles`);
    
    // Create vehicles with the created profiles
    console.log('Creating sample vehicles...');
    const vehiclePromises = sampleVehicles.map(async (vehicle, index) => {
      const profile = validProfiles[index % validProfiles.length];
      if (!profile) return null;
      
      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          color: vehicle.color,
          mileage: vehicle.mileage,
          vin: vehicle.vin,
          description: vehicle.description,
          user_id: profile.id,
          created_at: new Date(Date.now() - (index * 3600000)).toISOString() // Stagger creation times
        })
        .select()
        .single();
        
      if (error) {
        console.error(`Error creating vehicle ${vehicle.make} ${vehicle.model}:`, error);
        return null;
      }
      
      return data;
    });
    
    const createdVehicles = await Promise.all(vehiclePromises);
    const validVehicles = createdVehicles.filter(v => v !== null);
    
    console.log(`Created ${validVehicles.length} vehicles`);
    
    // Add sample vehicle images using the existing image files
    console.log('Adding vehicle images...');
    const imageFiles = fs.readdirSync('/Users/skylar/nuke/images').filter(f => f.endsWith('.jpeg'));
    
    const imagePromises = validVehicles.map(async (vehicle, index) => {
      const imageFile = imageFiles[index % imageFiles.length];
      if (!imageFile) return null;
      
      // Create a mock image URL (in a real scenario, these would be uploaded to Supabase storage)
      const imageUrl = `/images/${imageFile}`;
      
      const { data, error } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: vehicle.id,
          image_url: imageUrl,
          category: 'exterior',
          created_at: new Date().toISOString()
        })
        .select()
        .single();
        
      if (error) {
        console.error(`Error adding image for vehicle ${vehicle.id}:`, error);
        return null;
      }
      
      return data;
    });
    
    const createdImages = await Promise.all(imagePromises);
    const validImages = createdImages.filter(i => i !== null);
    
    console.log(`Added ${validImages.length} vehicle images`);
    
    console.log('✅ Discovery feed populated successfully!');
    console.log(`Summary: ${validProfiles.length} profiles, ${validVehicles.length} vehicles, ${validImages.length} images`);
    
  } catch (error) {
    console.error('Error populating discovery feed:', error);
  }
}

// Run the population script
populateDiscoveryFeed();
