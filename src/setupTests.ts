
import { expect, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import '@testing-library/jest-dom/matchers';
import { config } from './config/environment';

// Ensure all features use real data in tests
beforeAll(() => {
  // Use test environment configuration
  process.env.VITE_ENV = 'test';
  
  // Set placeholder values for required environment variables
  process.env.VITE_SUPABASE_URL = config.supabaseUrl;
  process.env.VITE_SUPABASE_ANON_KEY = config.supabaseAnonKey;
  process.env.VITE_ESCROW_CONTRACT_ADDRESS = '0x0';
});

// Extend Vitest's expect method with methods from react-testing-library
expect.extend(matchers);

// Cleanup after each test case
afterEach(() => {
  cleanup();
});

