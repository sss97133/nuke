#!/usr/bin/env node
/**
 * Browser Testing Tool
 * Automated browser testing with screenshots and logs
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class BrowserTester {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:5174';
    this.headless = options.headless !== false; // Default to headless
    this.slowMo = options.slowMo || 100;
    this.browser = null;
    this.page = null;
    this.logs = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, type, message };
    this.logs.push(logEntry);
    
    const icon = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : '✅';
    console.log(`${icon} ${message}`);
  }

  async initialize() {
    this.log('Launching browser...');
    
    this.browser = await puppeteer.launch({
      headless: this.headless,
      slowMo: this.slowMo,
      defaultViewport: { width: 1400, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });
    
    this.page = await this.browser.newPage();
    
    // Capture console logs
    this.page.on('console', msg => {
      this.log(`Browser: ${msg.text()}`, 'browser');
    });
    
    // Capture errors
    this.page.on('pageerror', error => {
      this.log(`Page Error: ${error.message}`, 'error');
    });
    
    // Capture network failures
    this.page.on('requestfailed', request => {
      this.log(`Network Error: ${request.url()} - ${request.failure().errorText}`, 'error');
    });
  }

  async screenshot(name, fullPage = false) {
    const timestamp = Date.now();
    const filename = `${name}-${timestamp}.png`;
    const dir = path.join(__dirname, 'test-screenshots');
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const filepath = path.join(dir, filename);
    await this.page.screenshot({ path: filepath, fullPage });
    
    this.log(`Screenshot saved: ${filename}`);
    return filepath;
  }

  async testPage(url, testName) {
    this.log(`Testing ${testName}: ${url}`);
    
    try {
      await this.page.goto(url, { 
        waitUntil: 'networkidle0', 
        timeout: 30000 
      });
      
      await this.screenshot(testName.toLowerCase().replace(/\s+/g, '-'));
      
      // Get page info
      const pageInfo = await this.page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          hasReact: !!window.React || !!document.querySelector('#root'),
          errorElements: document.querySelectorAll('.error, [class*="error"]').length,
          loadingElements: document.querySelectorAll('.loading, [class*="loading"]').length,
          formElements: document.querySelectorAll('form').length,
          inputElements: document.querySelectorAll('input').length,
          buttonElements: document.querySelectorAll('button').length
        };
      });
      
      this.log(`Page loaded: ${pageInfo.title}`);
      this.log(`Elements found: ${pageInfo.inputElements} inputs, ${pageInfo.buttonElements} buttons, ${pageInfo.formElements} forms`);
      
      if (pageInfo.errorElements > 0) {
        this.log(`Found ${pageInfo.errorElements} error elements`, 'warn');
      }
      
      return pageInfo;
    } catch (error) {
      this.log(`Failed to test ${testName}: ${error.message}`, 'error');
      await this.screenshot(`${testName}-error`);
      return null;
    }
  }

  async testProfileSync() {
    this.log('Testing Profile Synchronization...');
    
    // Test profile page
    const profileInfo = await this.testPage(`${this.baseUrl}/profile`, 'Profile Page');
    
    if (profileInfo) {
      // Look for profile-specific elements
      const profileElements = await this.page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return {
          hasVehicleCount: text.includes('vehicle'),
          hasStats: text.includes('stats') || text.includes('statistics'),
          hasActivity: text.includes('activity') || text.includes('recent'),
          hasContributions: text.includes('contribution'),
          hasAchievements: text.includes('achievement') || text.includes('badge')
        };
      });
      
      this.log(`Profile elements: ${JSON.stringify(profileElements)}`);
      
      // Take a full page screenshot of the profile
      await this.screenshot('profile-full-page', true);
    }
  }

  async testVehicleFlow() {
    this.log('Testing Vehicle Creation Flow...');
    
    // Test add vehicle page
    const vehicleInfo = await this.testPage(`${this.baseUrl}/add-vehicle`, 'Add Vehicle Page');
    
    if (vehicleInfo) {
      // Look for vehicle form fields
      const formFields = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const selects = Array.from(document.querySelectorAll('select'));
        
        return {
          yearField: inputs.find(i => i.name?.includes('year') || i.placeholder?.includes('year')),
          makeField: inputs.find(i => i.name?.includes('make') || i.placeholder?.includes('make')),
          modelField: inputs.find(i => i.name?.includes('model') || i.placeholder?.includes('model')),
          vinField: inputs.find(i => i.name?.includes('vin') || i.placeholder?.includes('vin')),
          totalInputs: inputs.length,
          totalSelects: selects.length
        };
      });
      
      this.log(`Vehicle form fields found: ${formFields.totalInputs} inputs, ${formFields.totalSelects} selects`);
      this.log(`Key fields: Year=${!!formFields.yearField}, Make=${!!formFields.makeField}, Model=${!!formFields.modelField}, VIN=${!!formFields.vinField}`);
      
      await this.screenshot('vehicle-form-full', true);
    }
  }

  async testAllPages() {
    const pages = [
      { url: this.baseUrl, name: 'Home Page' },
      { url: `${this.baseUrl}/login`, name: 'Login Page' },
      { url: `${this.baseUrl}/dashboard`, name: 'Dashboard' },
      { url: `${this.baseUrl}/vehicles`, name: 'Vehicles List' },
      { url: `${this.baseUrl}/profile`, name: 'Profile Page' },
      { url: `${this.baseUrl}/add-vehicle`, name: 'Add Vehicle' }
    ];
    
    for (const page of pages) {
      await this.testPage(page.url, page.name);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait between pages
    }
  }

  async generateReport() {
    const timestamp = new Date().toISOString();
    const report = {
      timestamp,
      testSuite: 'Browser Testing',
      baseUrl: this.baseUrl,
      logs: this.logs,
      summary: {
        totalLogs: this.logs.length,
        errors: this.logs.filter(l => l.type === 'error').length,
        warnings: this.logs.filter(l => l.type === 'warn').length
      }
    };
    
    const reportPath = path.join(__dirname, 'test-reports', `browser-test-${timestamp.replace(/[:.]/g, '-')}.json`);
    const dir = path.dirname(reportPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    this.log(`Report saved: ${reportPath}`);
    return report;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async runFullTest() {
    try {
      await this.initialize();
      await this.testAllPages();
      await this.testProfileSync();
      await this.testVehicleFlow();
      await this.generateReport();
      
      this.log('✅ All tests completed!');
    } catch (error) {
      this.log(`Test suite failed: ${error.message}`, 'error');
    } finally {
      await this.close();
    }
  }
}

// Command line interface
const args = process.argv.slice(2);
const options = {};

// Parse command line arguments
args.forEach(arg => {
  if (arg === '--headless') options.headless = true;
  if (arg === '--no-headless') options.headless = false;
  if (arg.startsWith('--url=')) options.baseUrl = arg.split('=')[1];
  if (arg.startsWith('--slow=')) options.slowMo = parseInt(arg.split('=')[1]);
});

if (require.main === module) {
  const tester = new BrowserTester(options);
  
  console.log('🚀 Starting Browser Tests...');
  console.log(`📍 Base URL: ${options.baseUrl || 'http://localhost:5174'}`);
  console.log(`👁️  Headless: ${options.headless !== false}`);
  console.log('');
  
  tester.runFullTest()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = BrowserTester;
