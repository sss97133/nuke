#!/usr/bin/env node
/**
 * Test Runner - Simple interface for running tests
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 NUKE Platform Testing Suite');
console.log('==============================\n');

const tests = {
  '1': {
    name: 'Quick Health Check',
    script: 'scripts/quick-test.js',
    description: 'Fast database and sync status check'
  },
  '2': {
    name: 'Profile Sync Test',
    script: 'scripts/test-profile-sync.js',
    description: 'Comprehensive profile synchronization testing'
  },
  '3': {
    name: 'Browser Test (Headless)',
    script: 'scripts/browser-test.js',
    args: ['--headless'],
    description: 'Automated browser testing with screenshots'
  },
  '4': {
    name: 'Browser Test (Visual)',
    script: 'scripts/browser-test.js',
    args: ['--no-headless'],
    description: 'Interactive browser testing (opens browser window)'
  },
  '5': {
    name: 'Sync Status Only',
    script: 'scripts/quick-test.js',
    args: ['sync'],
    description: 'Just check if vehicle counts are synchronized'
  }
};

function showMenu() {
  console.log('Available Tests:');
  Object.entries(tests).forEach(([key, test]) => {
    console.log(`  ${key}. ${test.name}`);
    console.log(`     ${test.description}`);
  });
  console.log('\nUsage:');
  console.log('  node test-runner.js [test-number]');
  console.log('  node test-runner.js 1    # Run quick health check');
  console.log('  node test-runner.js 3    # Run headless browser test');
  console.log('\nDirect script usage:');
  console.log('  node scripts/quick-test.js');
  console.log('  node scripts/quick-test.js sync');
  console.log('  node scripts/browser-test.js --no-headless');
}

function runTest(testKey) {
  const test = tests[testKey];
  if (!test) {
    console.log(`❌ Test "${testKey}" not found`);
    showMenu();
    return;
  }
  
  console.log(`🚀 Running: ${test.name}`);
  console.log(`📝 ${test.description}\n`);
  
  const scriptPath = path.join(__dirname, test.script);
  const args = test.args || [];
  
  const child = spawn('node', [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: __dirname
  });
  
  child.on('close', (code) => {
    if (code === 0) {
      console.log(`\n✅ ${test.name} completed successfully`);
    } else {
      console.log(`\n❌ ${test.name} failed with code ${code}`);
    }
  });
  
  child.on('error', (error) => {
    console.log(`❌ Failed to start test: ${error.message}`);
  });
}

// Parse command line
const testKey = process.argv[2];

if (!testKey) {
  showMenu();
} else {
  runTest(testKey);
}
