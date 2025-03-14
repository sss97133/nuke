#!/usr/bin/env node
/**
 * Simple Supabase connection test using established environment variable patterns
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup path handling for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables using the established pattern
dotenv.config({ path: path.join(rootDir, '.env') });

console.log('🧪 Testing Supabase Connection');
console.log('================================');

// Get environment variables using the fallback pattern
const getEnvVar = (name) => {
  // Following your established fallback pattern from MEMORIES
  return process.env?.[name] || 
         (typeof window !== 'undefined' && window.__env?.[name]);
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
const supabaseServiceKey = getEnvVar('VITE_SUPABASE_SERVICE_KEY') || 
                           getEnvVar('VITE_SUPABASE_ANON_KEY');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  console.error('Required: VITE_SUPABASE_URL and either VITE_SUPABASE_SERVICE_KEY or VITE_SUPABASE_ANON_KEY');
  console.error(`Found VITE_SUPABASE_URL: ${supabaseUrl ? 'Yes' : 'No'}`);
  console.error(`Found VITE_SUPABASE_SERVICE_KEY: ${getEnvVar('VITE_SUPABASE_SERVICE_KEY') ? 'Yes' : 'No'}`);
  console.error(`Found VITE_SUPABASE_ANON_KEY: ${getEnvVar('VITE_SUPABASE_ANON_KEY') ? 'Yes' : 'No'}`);
  process.exit(1);
}

console.log(`✅ Found VITE_SUPABASE_URL: ${supabaseUrl.substring(0, 12)}...`);
console.log('✅ Found Supabase key');

// Initialize Supabase client
console.log('📊 Testing Supabase connection...');
try {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Try a simple health check query
  const { data, error } = await supabase.from('healthcheck').select('*').limit(1);
  
  if (error) {
    if (error.code === '42P01') { // Table doesn't exist
      console.log('ℹ️ No healthcheck table found, testing with another method...');
      // Try fetching schema info as a more reliable health check
      const { data: schema, error: schemaError } = await supabase
        .rpc('get_schema_info');
      
      if (schemaError) {
        if (schemaError.message.includes('function get_schema_info() does not exist')) {
          console.log('ℹ️ No schema helper function, trying direct version query...');
          // Last resort - try to get Postgres version
          const { data: version, error: versionError } = await supabase
            .rpc('version');
          
          if (versionError) {
            // Just test a basic system table query
            const { data: tablesData, error: tablesError } = await supabase
              .from('pg_tables')
              .select('tablename')
              .limit(1);
            
            if (tablesError) {
              throw new Error(`Failed all connection tests: ${tablesError.message}`);
            } else {
              console.log('✅ Supabase connection successful (verified via system tables)');
            }
          } else {
            console.log('✅ Supabase connection successful (verified via version)');
          }
        } else {
          throw new Error(`Schema query failed: ${schemaError.message}`);
        }
      } else {
        console.log('✅ Supabase connection successful (verified via schema info)');
      }
    } else {
      throw new Error(`Failed to query healthcheck: ${error.message}`);
    }
  } else {
    console.log('✅ Supabase connection successful (verified via healthcheck table)');
  }
  
  // Check if vehicles table exists
  const { data: vehiclesData, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id')
    .limit(1);
  
  if (vehiclesError && vehiclesError.code === '42P01') {
    console.log('❌ The vehicles table does not exist in this database');
    console.log('ℹ️ Note: You need the vehicles table for the timeline component to work');
  } else if (vehiclesError) {
    console.log(`❌ Error checking vehicles table: ${vehiclesError.message}`);
  } else {
    console.log('✅ Vehicles table exists and is accessible');
    
    // Check if timeline events table exists
    const { data: timelineData, error: timelineError } = await supabase
      .from('vehicle_timeline_events')
      .select('id')
      .limit(1);
    
    if (timelineError && timelineError.code === '42P01') {
      console.log('ℹ️ The vehicle_timeline_events table does not exist yet');
      console.log('ℹ️ Run the migration script to create it: migrations/vehicle_timeline.sql');
    } else if (timelineError) {
      console.log(`❌ Error checking timeline table: ${timelineError.message}`);
    } else {
      console.log('✅ Vehicle timeline events table exists and is accessible');
    }
  }
  
  console.log('================================');
  console.log('✅ Connection test completed successfully!');
  
} catch (error) {
  console.error('❌ Connection test failed:');
  console.error(error.message);
  process.exit(1);
}
