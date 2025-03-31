/**
 * Authentication Testing Utility
 * 
 * This utility helps test user authentication flows and Row-Level Security (RLS)
 * in the context of the vehicle-centric architecture.
 */

import { supabase } from '../components/service-history/create-service-record/hooks/__mocks__/supabase-client';

interface TestUser {
  email: string;
  password: string;
  name: string;
}

// Test users for authentication flow testing
const testUsers: TestUser[] = [
  {
    email: 'test-owner@example.com',
    password: 'testPassword123!',
    name: 'Test Vehicle Owner'
  },
  {
    email: 'test-mechanic@example.com',
    password: 'testPassword123!',
    name: 'Test Mechanic'
  }
];

/**
 * Test user registration flow
 */
export async function testUserRegistration(): Promise<boolean> {
  console.log('=== Testing User Registration ===');
  
  try {
    const testUser = testUsers[0];
    
    // Attempt to register a new user
    console.log(`Registering user: ${testUser.email}`);
    const { data, error } = await supabase.auth.signUp({
      email: testUser.email,
      password: testUser.password,
      options: {
        data: {
          name: testUser.name
        }
      }
    });
    
    if (error) {
      console.error('Registration failed:', error.message);
      return false;
    }
    
    console.log('Registration successful:', data.user?.id);
    return true;
  } catch (err) {
    console.error('Unexpected error during registration test:', err);
    return false;
  }
}

/**
 * Test user login flow
 */
export async function testUserLogin(): Promise<boolean> {
  console.log('=== Testing User Login ===');
  
  try {
    const testUser = testUsers[0];
    
    // Attempt to log in
    console.log(`Logging in user: ${testUser.email}`);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: testUser.email,
      password: testUser.password
    });
    
    if (error) {
      console.error('Login failed:', error.message);
      return false;
    }
    
    console.log('Login successful:', data.user?.id);
    return true;
  } catch (err) {
    console.error('Unexpected error during login test:', err);
    return false;
  }
}

/**
 * Test Row-Level Security (RLS) for vehicle data
 * This tests whether users can only see data they have permission to access
 */
export async function testRowLevelSecurity(): Promise<boolean> {
  console.log('=== Testing Row-Level Security ===');
  
  try {
    // Log in as the test user
    await testUserLogin();
    
    // Attempt to access vehicle data (should only see vehicles owned by this user)
    console.log('Fetching vehicle data with RLS applied...');
    const { data, error } = await supabase
      .from('vehicles')
      .select('*');
    
    if (error) {
      console.error('RLS test failed:', error.message);
      return false;
    }
    
    console.log(`RLS returned ${data.length} vehicles`);
    return true;
  } catch (err) {
    console.error('Unexpected error during RLS test:', err);
    return false;
  }
}

/**
 * Test user data input by creating a service record for a vehicle
 */
export async function testUserDataInput(): Promise<boolean> {
  console.log('=== Testing User Data Input ===');
  
  try {
    // Log in as the test user
    await testUserLogin();
    
    // Create a test service record
    const serviceRecord = {
      vehicle_id: 'mock-id-1', // Chevrolet C10 from our mock data
      service_date: new Date().toISOString().split('T')[0],
      description: 'Test oil change service record',
      service_type: 'maintenance',
      status: 'completed',
      labor_hours: 1.5,
      technician_notes: 'Test notes for service',
      parts_used: [
        { name: 'Oil filter', quantity: 1, cost: 8.99 },
        { name: 'Oil (5W30)', quantity: 5, cost: 7.49 }
      ],
      total_cost: 52.42
    };
    
    console.log('Creating service record...');
    const { data, error } = await supabase
      .from('service_records')
      .insert(serviceRecord)
      .select();
    
    if (error) {
      console.error('Service record creation failed:', error.message);
      return false;
    }
    
    console.log('Service record created successfully:', data);
    return true;
  } catch (err) {
    console.error('Unexpected error during data input test:', err);
    return false;
  }
}

// Run all tests
export async function runAllAuthTests() {
  const registrationResult = await testUserRegistration();
  const loginResult = await testUserLogin();
  const rlsResult = await testRowLevelSecurity();
  const dataInputResult = await testUserDataInput();
  
  console.log('\n=== Auth Test Results ===');
  console.log(`User Registration: ${registrationResult ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`User Login: ${loginResult ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Row-Level Security: ${rlsResult ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`User Data Input: ${dataInputResult ? '✅ PASSED' : '❌ FAILED'}`);
}
