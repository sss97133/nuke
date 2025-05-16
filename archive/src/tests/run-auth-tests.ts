/**
 * Authentication Test Runner
 * 
 * This script executes the authentication, RLS, and data input tests
 * to verify the system is working correctly with the vehicle-centric architecture.
 */

import { runAllAuthTests } from './auth-test';

console.log('Starting Authentication and Row-Level Security Tests...');
console.log('-----------------------------------------------------');
console.log('Testing authentication flows within the vehicle-centric architecture');
console.log('These tests verify that users can register, log in, access appropriate');
console.log('vehicle data based on permissions, and input service history data.');
console.log('-----------------------------------------------------\n');

// Run the tests
runAllAuthTests()
  .then(() => {
    console.log('\nTests completed!');
  })
  .catch(error => {
    console.error('Error running tests:', error);
  });
