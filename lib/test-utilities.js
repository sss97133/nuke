/**
 * Test Utilities Module
 * Common testing patterns extracted from 29+ test files
 */

const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

/**
 * Test Context Manager
 * Manages test lifecycle and cleanup
 */
class TestContext {
  constructor(prefix = 'test') {
    this.prefix = `${prefix}-${Date.now()}`;
    this.resources = {
      users: [],
      vehicles: [],
      browser: null,
      clients: new Map()
    };
  }

  // Generate unique test data
  generateVIN() {
    return `${this.prefix}-${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
  }

  generateEmail() {
    return `${this.prefix}@test.example.com`;
  }

  // Client management
  getClient(type = 'anon') {
    if (this.resources.clients.has(type)) {
      return this.resources.clients.get(type);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = type === 'service' ? 
      process.env.SUPABASE_SERVICE_ROLE_KEY :
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    const client = createClient(url, key);
    this.resources.clients.set(type, client);
    return client;
  }

  // User management
  async createTestUser(email = null, password = 'TestPass123!') {
    const client = this.getClient('anon');
    email = email || this.generateEmail();
    
    const { data, error } = await client.auth.signUp({
      email,
      password
    });
    
    if (error) throw error;
    this.resources.users.push(data.user.id);
    return { user: data.user, session: data.session, client };
  }

  async signIn(email, password) {
    const client = this.getClient('anon');
    const { data, error } = await client.auth.signInWithPassword({
      email, password
    });
    
    if (error) throw error;
    return { user: data.user, session: data.session, client };
  }

  // Vehicle management
  async createTestVehicle(client, overrides = {}) {
    const vehicleData = {
      vin: this.generateVIN(),
      make: 'TestMake',
      model: 'TestModel',
      year: 2024,
      ...overrides
    };

    const { data, error } = await client
      .from('vehicles')
      .insert(vehicleData)
      .select()
      .single();

    if (error) throw error;
    this.resources.vehicles.push(data.id);
    return data;
  }

  // Browser management
  async launchBrowser(options = {}) {
    if (this.resources.browser) {
      return this.resources.browser;
    }

    this.resources.browser = await puppeteer.launch({
      headless: options.headless ?? true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    return this.resources.browser;
  }

  async extractFromURL(url) {
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Run extraction
    const extractedData = await page.evaluate(() => {
      // This would use your extraction engine
      if (window.BATExtraction) {
        return window.BATExtraction.extract();
      }
      return null;
    });

    await page.close();
    return extractedData;
  }

  // Cleanup
  async cleanup() {
    // Clean vehicles
    if (this.resources.vehicles.length > 0) {
      const client = this.getClient('service');
      await client
        .from('vehicles')
        .delete()
        .in('id', this.resources.vehicles);
    }

    // Clean users
    if (this.resources.users.length > 0) {
      const client = this.getClient('service');
      for (const userId of this.resources.users) {
        await client.auth.admin.deleteUser(userId);
      }
    }

    // Close browser
    if (this.resources.browser) {
      await this.resources.browser.close();
    }

    // Clear clients
    this.resources.clients.clear();
  }
}

/**
 * Test Assertions
 * Common assertion helpers
 */
class TestAssertions {
  static assertVehicle(vehicle, expected) {
    const errors = [];
    
    if (expected.vin && vehicle.vin !== expected.vin) {
      errors.push(`VIN mismatch: ${vehicle.vin} !== ${expected.vin}`);
    }
    if (expected.make && vehicle.make !== expected.make) {
      errors.push(`Make mismatch: ${vehicle.make} !== ${expected.make}`);
    }
    if (expected.model && vehicle.model !== expected.model) {
      errors.push(`Model mismatch: ${vehicle.model} !== ${expected.model}`);
    }
    if (expected.year && vehicle.year !== expected.year) {
      errors.push(`Year mismatch: ${vehicle.year} !== ${expected.year}`);
    }
    
    return {
      passed: errors.length === 0,
      errors
    };
  }

  static assertExtraction(extraction, requiredFields = ['vin', 'make', 'model']) {
    const missing = requiredFields.filter(field => !extraction[field]);
    return {
      passed: missing.length === 0,
      missing
    };
  }

  static assertConfidence(extraction, minConfidence = 0.7) {
    const lowConfidence = [];
    
    for (const [key, value] of Object.entries(extraction)) {
      if (key.endsWith('_confidence') && value < minConfidence) {
        lowConfidence.push({ field: key.replace('_confidence', ''), confidence: value });
      }
    }
    
    return {
      passed: lowConfidence.length === 0,
      lowConfidence
    };
  }
}

/**
 * Test Runner
 * Orchestrates test execution
 */
class TestRunner {
  constructor(name) {
    this.name = name;
    this.context = new TestContext(name);
    this.results = [];
  }

  async run(testFn, description) {
    const start = Date.now();
    let result = {
      description,
      passed: false,
      duration: 0,
      error: null
    };

    try {
      await testFn(this.context);
      result.passed = true;
    } catch (error) {
      result.error = error.message;
    }

    result.duration = Date.now() - start;
    this.results.push(result);
    
    // Log result
    if (result.passed) {
      console.log(`✅ ${description} (${result.duration}ms)`);
    } else {
      console.log(`❌ ${description}: ${result.error}`);
    }

    return result;
  }

  async cleanup() {
    await this.context.cleanup();
  }

  summary() {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.length - passed;
    const duration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log('\n📊 Test Summary:');
    console.log(`  Passed: ${passed}/${this.results.length}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Duration: ${duration}ms`);

    return {
      passed,
      failed,
      total: this.results.length,
      duration,
      results: this.results
    };
  }
}

/**
 * Test Fixtures
 * Common test data
 */
const fixtures = {
  vehicles: {
    honda: {
      vin: '1HGCM82633A123456',
      make: 'Honda',
      model: 'Accord',
      year: 2023,
      mileage: 25000,
      price: 28500,
      exterior_color: 'Silver'
    },
    toyota: {
      vin: '4T1BF1FK5CU123456',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      mileage: 30000,
      price: 26000,
      exterior_color: 'Black'
    }
  },
  
  urls: {
    bat: 'https://bringatrailer.com/listing/test-vehicle/',
    carsAndBids: 'https://carsandbids.com/auctions/test-vehicle'
  }
};

module.exports = {
  TestContext,
  TestAssertions,
  TestRunner,
  fixtures
};
