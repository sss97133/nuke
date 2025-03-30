#!/usr/bin/env node

/**
 * Supabase Connection Test
 * 
 * This script tests the connection to your Supabase instance using
 * the environment variables and confirms that vehicle data can be
 * properly accessed. It respects the vehicle-centric architecture
 * of the Nuke project.
 */

// Import the correct environment variables
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Define colors for console output
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

// Print a styled header
console.log(`${COLORS.cyan}================================${COLORS.reset}`);
console.log(`${COLORS.cyan}   SUPABASE CONNECTION TEST     ${COLORS.reset}`);
console.log(`${COLORS.cyan}================================${COLORS.reset}`);

// Collect environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL || 
                   (typeof window !== 'undefined' && window.__env?.VITE_SUPABASE_URL) || 
                   'http://127.0.0.1:54321';

const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 
                   (typeof window !== 'undefined' && window.__env?.VITE_SUPABASE_ANON_KEY) || 
                   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// Display found environment variables
console.log(`\n${COLORS.yellow}Found Environment Variables:${COLORS.reset}`);
console.log(`VITE_SUPABASE_URL: ${supabaseUrl}`);
console.log(`VITE_SUPABASE_ANON_KEY: ${supabaseKey ? 'Found (value hidden for security)' : 'Not found'}`);

// Main function to test connection
async function testConnection() {
  try {
    // Create a Supabase client
    console.log(`\n${COLORS.blue}Creating Supabase client...${COLORS.reset}`);
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Test the basic connection
    console.log(`${COLORS.blue}Testing connection...${COLORS.reset}`);
    
    // Get the Supabase health status directly
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/health`);
      if (response.ok) {
        console.log(`${COLORS.green}✓ Connection successful! Auth services are available.${COLORS.reset}`);
        const data = await response.json();
        console.log(`Health check: ${JSON.stringify(data)}`);
      } else {
        console.log(`${COLORS.yellow}⚠ Auth service responded with status ${response.status}${COLORS.reset}`);
        // Continue anyway since some features might still work
      }
    } catch (error) {
      console.log(`${COLORS.yellow}⚠ Could not perform health check: ${error.message}${COLORS.reset}`);
      console.log(`${COLORS.yellow}Continuing with database checks anyway...${COLORS.reset}`);
    }
    
    // Test vehicle data access
    console.log(`\n${COLORS.blue}Testing vehicle data access...${COLORS.reset}`);
    const { data: vehicles, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .limit(5);
    
    if (vehicleError) {
      console.log(`${COLORS.red}✗ Vehicle data access failed: ${vehicleError.message}${COLORS.reset}`);
      console.log(`This could be due to missing vehicles table or permissions issues.`);
    } else if (!vehicles || vehicles.length === 0) {
      console.log(`${COLORS.yellow}⚠ No vehicle data found, but connection is working.${COLORS.reset}`);
      console.log(`You may need to create your vehicles table or add test data.`);
    } else {
      console.log(`${COLORS.green}✓ Successfully accessed vehicle data!${COLORS.reset}`);
      console.log(`Found ${vehicles.length} vehicle records.`);
      console.log(`First vehicle: ${JSON.stringify(vehicles[0])}`);
    }
    
    // Test timeline events
    console.log(`\n${COLORS.blue}Testing timeline events access...${COLORS.reset}`);
    const { data: events, error: eventsError } = await supabase
      .from('timeline_events')
      .select('*')
      .limit(5);
    
    if (eventsError) {
      console.log(`${COLORS.red}✗ Timeline events access failed: ${eventsError.message}${COLORS.reset}`);
      console.log(`This could be due to missing timeline_events table or permissions issues.`);
    } else if (!events || events.length === 0) {
      console.log(`${COLORS.yellow}⚠ No timeline events found, but connection is working.${COLORS.reset}`);
      console.log(`You may need to create your timeline_events table or add test data.`);
    } else {
      console.log(`${COLORS.green}✓ Successfully accessed timeline events!${COLORS.reset}`);
      console.log(`Found ${events.length} timeline event records.`);
      console.log(`First event: ${JSON.stringify(events[0])}`);
    }
    
    // Test authentication
    console.log(`\n${COLORS.blue}Testing authentication service...${COLORS.reset}`);
    const { data: authData, error: authError } = await supabase.auth.getSession();
    
    if (authError) {
      console.log(`${COLORS.red}✗ Auth service access failed: ${authError.message}${COLORS.reset}`);
    } else {
      console.log(`${COLORS.green}✓ Auth service is working properly!${COLORS.reset}`);
      console.log(`Current session: ${authData.session ? 'Active' : 'None'}`);
    }
    
    // Test WebSocket connection
    console.log(`\n${COLORS.blue}Testing WebSocket connection...${COLORS.reset}`);
    try {
      const channel = supabase.channel('test-channel');
      
      const subscription = channel
        .on('broadcast', { event: 'test' }, (payload) => {
          console.log(`${COLORS.green}✓ WebSocket message received: ${JSON.stringify(payload)}${COLORS.reset}`);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`${COLORS.green}✓ WebSocket connection successful!${COLORS.reset}`);
            
            // Send a test message
            setTimeout(() => {
              channel.send({
                type: 'broadcast',
                event: 'test',
                payload: { message: 'Hello from test script' }
              });
              
              // Clean up subscription after a short delay
              setTimeout(() => {
                supabase.removeChannel(channel);
                console.log(`${COLORS.blue}WebSocket test completed and channel removed.${COLORS.reset}`);
                
                // Print summary
                console.log(`\n${COLORS.cyan}================================${COLORS.reset}`);
                console.log(`${COLORS.cyan}   CONNECTION TEST COMPLETE     ${COLORS.reset}`);
                console.log(`${COLORS.cyan}================================${COLORS.reset}`);
                process.exit(0);
              }, 2000);
            }, 1000);
          } else {
            console.log(`${COLORS.yellow}WebSocket status: ${status}${COLORS.reset}`);
          }
        });
    } catch (wsError) {
      console.log(`${COLORS.red}✗ WebSocket connection failed: ${wsError.message}${COLORS.reset}`);
      
      // Print summary anyway
      console.log(`\n${COLORS.cyan}================================${COLORS.reset}`);
      console.log(`${COLORS.cyan}   CONNECTION TEST COMPLETE     ${COLORS.reset}`);
      console.log(`${COLORS.cyan}================================${COLORS.reset}`);
      process.exit(1);
    }
    
  } catch (error) {
    console.log(`${COLORS.red}✗ Error: ${error.message}${COLORS.reset}`);
    console.log(`\nPlease check your environment variables and make sure your Supabase instance is running.`);
    console.log(`If using a local Supabase instance, run: npx supabase start`);
    
    console.log(`\n${COLORS.cyan}================================${COLORS.reset}`);
    console.log(`${COLORS.cyan}   CONNECTION TEST FAILED       ${COLORS.reset}`);
    console.log(`${COLORS.cyan}================================${COLORS.reset}`);
    process.exit(1);
  }
}

// Run the test
testConnection();
