#!/usr/bin/env node
/**
 * Profile Sync Testing Script
 * Tests the user-vehicle profile synchronization system
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Configuration
const FRONTEND_URL = 'http://localhost:5174';
const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class ProfileSyncTester {
  constructor() {
    this.browser = null;
    this.page = null;
    this.testResults = [];
    this.screenshots = [];
  }

  async initialize() {
    console.log('🚀 Initializing Profile Sync Tester...');
    
    this.browser = await puppeteer.launch({
      headless: false, // Set to true for CI/CD
      defaultViewport: { width: 1400, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    this.page = await this.browser.newPage();
    
    // Enable console logging from the page
    this.page.on('console', msg => {
      console.log('🌐 Browser Console:', msg.text());
    });
    
    // Listen for network requests
    this.page.on('response', response => {
      if (response.url().includes('supabase.co')) {
        console.log('📡 Supabase Request:', response.status(), response.url());
      }
    });
  }

  async takeScreenshot(name, fullPage = false) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${name}-${timestamp}.png`;
    const filepath = path.join(__dirname, 'test-screenshots', filename);
    
    // Ensure directory exists
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    await this.page.screenshot({ 
      path: filepath, 
      fullPage 
    });
    
    this.screenshots.push({ name, filepath, timestamp });
    console.log('📸 Screenshot saved:', filename);
    return filepath;
  }

  async testDatabaseConnection() {
    console.log('\n🔍 Testing Database Connection...');
    
    try {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .limit(1);
      
      if (error) throw error;
      
      this.testResults.push({
        test: 'Database Connection',
        status: 'PASS',
        message: `Connected successfully. Found ${profiles.length} profile(s)`
      });
      
      return profiles[0]?.id;
    } catch (error) {
      this.testResults.push({
        test: 'Database Connection',
        status: 'FAIL',
        message: error.message
      });
      return null;
    }
  }

  async testFrontendLoad() {
    console.log('\n🌐 Testing Frontend Load...');
    
    try {
      await this.page.goto(FRONTEND_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      
      await this.takeScreenshot('frontend-load');
      
      // Check for React app
      const title = await this.page.title();
      const hasReactRoot = await this.page.$('#root') !== null;
      
      this.testResults.push({
        test: 'Frontend Load',
        status: hasReactRoot ? 'PASS' : 'FAIL',
        message: `Page title: "${title}", React root: ${hasReactRoot}`
      });
      
      return hasReactRoot;
    } catch (error) {
      this.testResults.push({
        test: 'Frontend Load',
        status: 'FAIL',
        message: error.message
      });
      
      await this.takeScreenshot('frontend-load-error');
      return false;
    }
  }

  async testLoginFlow() {
    console.log('\n🔐 Testing Login Flow...');
    
    try {
      // Navigate to login page
      await this.page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle0' });
      await this.takeScreenshot('login-page');
      
      // Check if login form exists
      const emailInput = await this.page.$('input[type="email"]');
      const passwordInput = await this.page.$('input[type="password"]');
      const loginButton = await this.page.$('button[type="submit"], button:contains("Login"), button:contains("Sign")');
      
      const hasLoginForm = emailInput && passwordInput && loginButton;
      
      this.testResults.push({
        test: 'Login Form Present',
        status: hasLoginForm ? 'PASS' : 'FAIL',
        message: `Email input: ${!!emailInput}, Password input: ${!!passwordInput}, Submit button: ${!!loginButton}`
      });
      
      return hasLoginForm;
    } catch (error) {
      this.testResults.push({
        test: 'Login Flow',
        status: 'FAIL',
        message: error.message
      });
      return false;
    }
  }

  async testProfilePage() {
    console.log('\n👤 Testing Profile Page...');
    
    try {
      await this.page.goto(`${FRONTEND_URL}/profile`, { waitUntil: 'networkidle0' });
      await this.takeScreenshot('profile-page');
      
      // Check for profile elements
      const profileElements = await this.page.evaluate(() => {
        return {
          hasProfileStats: !!document.querySelector('[data-testid="profile-stats"], .profile-stats, .stats'),
          hasVehicleCount: document.body.innerText.includes('vehicle') || document.body.innerText.includes('Vehicle'),
          hasActivityFeed: !!document.querySelector('[data-testid="activity-feed"], .activity, .feed'),
          hasContributions: document.body.innerText.includes('contribution') || document.body.innerText.includes('Contribution')
        };
      });
      
      this.testResults.push({
        test: 'Profile Page Elements',
        status: profileElements.hasProfileStats ? 'PASS' : 'PARTIAL',
        message: JSON.stringify(profileElements, null, 2)
      });
      
      return profileElements;
    } catch (error) {
      this.testResults.push({
        test: 'Profile Page',
        status: 'FAIL',
        message: error.message
      });
      return null;
    }
  }

  async testVehicleCreation() {
    console.log('\n🚗 Testing Vehicle Creation Flow...');
    
    try {
      await this.page.goto(`${FRONTEND_URL}/add-vehicle`, { waitUntil: 'networkidle0' });
      await this.takeScreenshot('add-vehicle-page');
      
      // Check for vehicle form elements
      const formElements = await this.page.evaluate(() => {
        const inputs = document.querySelectorAll('input');
        const selects = document.querySelectorAll('select');
        const textareas = document.querySelectorAll('textarea');
        
        return {
          totalInputs: inputs.length,
          hasYearField: Array.from(inputs).some(input => 
            input.name?.toLowerCase().includes('year') || 
            input.placeholder?.toLowerCase().includes('year')
          ),
          hasMakeField: Array.from(inputs).some(input => 
            input.name?.toLowerCase().includes('make') || 
            input.placeholder?.toLowerCase().includes('make')
          ),
          hasModelField: Array.from(inputs).some(input => 
            input.name?.toLowerCase().includes('model') || 
            input.placeholder?.toLowerCase().includes('model')
          ),
          hasSubmitButton: !!document.querySelector('button[type="submit"], .submit, .save')
        };
      });
      
      this.testResults.push({
        test: 'Vehicle Form Elements',
        status: formElements.hasYearField && formElements.hasMakeField ? 'PASS' : 'FAIL',
        message: JSON.stringify(formElements, null, 2)
      });
      
      return formElements;
    } catch (error) {
      this.testResults.push({
        test: 'Vehicle Creation',
        status: 'FAIL',
        message: error.message
      });
      return null;
    }
  }

  async checkProfileSync(userId) {
    console.log('\n🔄 Checking Profile Synchronization...');
    
    try {
      // Get current counts from database
      const [vehiclesResult, statsResult, contributionsResult] = await Promise.all([
        supabase.from('vehicles').select('id').eq('user_id', userId),
        supabase.from('profile_stats').select('*').eq('user_id', userId).single(),
        supabase.from('user_contributions').select('*').eq('user_id', userId)
      ]);
      
      const vehicleCount = vehiclesResult.data?.length || 0;
      const trackedVehicles = statsResult.data?.total_vehicles || 0;
      const contributionCount = contributionsResult.data?.length || 0;
      
      const syncData = {
        vehicleCount,
        trackedVehicles,
        contributionCount,
        syncStatus: vehicleCount === trackedVehicles ? 'SYNCED' : 'OUT_OF_SYNC',
        lastActivity: statsResult.data?.last_activity
      };
      
      this.testResults.push({
        test: 'Profile Synchronization',
        status: syncData.syncStatus === 'SYNCED' ? 'PASS' : 'FAIL',
        message: JSON.stringify(syncData, null, 2)
      });
      
      return syncData;
    } catch (error) {
      this.testResults.push({
        test: 'Profile Sync Check',
        status: 'FAIL',
        message: error.message
      });
      return null;
    }
  }

  async generateReport() {
    console.log('\n📊 Generating Test Report...');
    
    const timestamp = new Date().toISOString();
    const report = {
      timestamp,
      testSuite: 'Profile Sync Testing',
      summary: {
        total: this.testResults.length,
        passed: this.testResults.filter(t => t.status === 'PASS').length,
        failed: this.testResults.filter(t => t.status === 'FAIL').length,
        partial: this.testResults.filter(t => t.status === 'PARTIAL').length
      },
      results: this.testResults,
      screenshots: this.screenshots
    };
    
    const reportPath = path.join(__dirname, 'test-reports', `profile-sync-report-${timestamp.replace(/[:.]/g, '-')}.json`);
    
    // Ensure directory exists
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log('\n📋 TEST SUMMARY');
    console.log('================');
    console.log(`Total Tests: ${report.summary.total}`);
    console.log(`✅ Passed: ${report.summary.passed}`);
    console.log(`❌ Failed: ${report.summary.failed}`);
    console.log(`⚠️  Partial: ${report.summary.partial}`);
    console.log(`📄 Report saved: ${reportPath}`);
    
    return report;
  }

  async runFullTest() {
    try {
      await this.initialize();
      
      // Run all tests
      const userId = await this.testDatabaseConnection();
      await this.testFrontendLoad();
      await this.testLoginFlow();
      await this.testProfilePage();
      await this.testVehicleCreation();
      
      if (userId) {
        await this.checkProfileSync(userId);
      }
      
      const report = await this.generateReport();
      
      return report;
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new ProfileSyncTester();
  tester.runFullTest()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = ProfileSyncTester;
