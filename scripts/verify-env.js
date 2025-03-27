/* eslint-disable no-undef */
/**
 * Verifies environment variables are properly set and accessible
 * Run this script during build to explicitly check all required variables
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as process from 'process';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// List of required environment variables
const REQUIRED_VARS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_SERVICE_KEY'
];

console.log('=============================================');
console.log('ENVIRONMENT VARIABLE VERIFICATION');
console.log('=============================================');

// Check for variables in process.env
console.log('\nChecking process.env:');
let processEnvMissing = [];
for (const varName of REQUIRED_VARS) {
  if (!process.env[varName]) {
    console.error(`❌ Missing ${varName} in process.env`);
    processEnvMissing.push(varName);
  } else {
    console.log(`✅ Found ${varName} in process.env`);
  }
}

// Create a verification HTML file with results
const verificationPath = path.resolve(__dirname, '../dist/verification.html');
const verificationDir = path.dirname(verificationPath);

// Ensure directory exists
if (!fs.existsSync(verificationDir)) {
  fs.mkdirSync(verificationDir, { recursive: true });
}

// Create verification file
fs.writeFileSync(
  verificationPath,
  `<!DOCTYPE html>
<html>
<head>
  <title>Environment Variable Verification</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    .success { color: green; }
    .error { color: red; }
    .variable { font-family: monospace; background: #f0f0f0; padding: 2px 4px; }
    .verification { margin-top: 40px; }
  </style>
</head>
<body>
  <h1>Environment Variable Verification</h1>
  <p>This page shows the status of environment variables at build time.</p>
  
  <h2>Build-time Variables (process.env)</h2>
  <ul>
    ${REQUIRED_VARS.map(name => {
      const present = !!process.env[name];
      return `<li class="${present ? 'success' : 'error'}">
        <span class="variable">${name}</span>: ${present ? 'Present ✅' : 'Missing ❌'}
      </li>`;
    }).join('\n    ')}
  </ul>

  <h2>Runtime Variables (window.__env)</h2>
  <p>Will be checked when this page is loaded in the browser</p>
  <ul id="runtime-vars">
    <li>Loading...</li>
  </ul>

  <div class="verification">
    <h2>Supabase Connection Test</h2>
    <p id="connection-status">Testing connection...</p>
  </div>

  <script>
    // Check runtime variables
    document.addEventListener('DOMContentLoaded', () => {
      const runtimeVarsList = document.getElementById('runtime-vars');
      runtimeVarsList.innerHTML = '';
      
      const requiredVars = ${JSON.stringify(REQUIRED_VARS)};
      let allPresent = true;
      
      requiredVars.forEach(name => {
        const present = window.__env && window.__env[name];
        allPresent = allPresent && present;
        
        const li = document.createElement('li');
        li.className = present ? 'success' : 'error';
        li.innerHTML = \`<span class="variable">\${name}</span>: \${present ? 'Present ✅' : 'Missing ❌'}\`;
        runtimeVarsList.appendChild(li);
      });

      // Test Supabase connection if variables are present
      const connectionStatus = document.getElementById('connection-status');
      if (!allPresent) {
        connectionStatus.textContent = 'Cannot test connection: Missing environment variables';
        connectionStatus.className = 'error';
      } else {
        // This will be replaced by actual connection test code
        connectionStatus.textContent = 'Environment variables are present, initializing connection...';
        
        // Add connection test after framework is loaded
        const script = document.createElement('script');
        script.src = '/assets/connection-test.js';
        document.body.appendChild(script);
      }
    });
  </script>
</body>
</html>`
);

console.log(`\n✅ Created verification page at ${verificationPath}`);

// Create a minimal Supabase connection test script
const testScriptDir = path.resolve(__dirname, '../dist/assets');
if (!fs.existsSync(testScriptDir)) {
  fs.mkdirSync(testScriptDir, { recursive: true });
}

fs.writeFileSync(
  path.resolve(testScriptDir, 'connection-test.js'),
  `// Simple script to test Supabase connection
(function() {
  const connectionStatus = document.getElementById('connection-status');
  try {
    const url = window.__env.VITE_SUPABASE_URL;
    const key = window.__env.VITE_SUPABASE_ANON_KEY;
    
    connectionStatus.textContent = 'Found Supabase credentials, will attempt connection on app load';
    connectionStatus.className = 'success';
    
    // Log values for debugging (length only for security)
    console.log('Supabase URL found, length:', url?.length);
    console.log('Supabase Key found, length:', key?.length);
    
    // Add link to actual app
    const link = document.createElement('p');
    link.innerHTML = '<a href="/">Go to application</a>';
    connectionStatus.parentNode.appendChild(link);
  } catch (error) {
    connectionStatus.textContent = 'Error testing connection: ' + error.message;
    connectionStatus.className = 'error';
    console.error('Connection test error:', error);
  }
})();`
);

// Determine if we should fail the build
const shouldFailBuild = process.env.STRICT_ENV_CHECK === 'true';

// Handle missing variables
if (processEnvMissing.length > 0) {
  console.error('\n⚠️ WARNING: Missing required environment variables in process.env!');
  console.error('The following variables should be set:');
  processEnvMissing.forEach(name => console.error(`  - ${name}`));
  console.error('\nEnsure these are set in your Vercel project settings or environment.');
  
  // Create warning file to help debugging
  fs.writeFileSync(
    path.resolve(__dirname, '../dist/env-warning.txt'),
    `WARNING: Missing environment variables detected during build\n\n${processEnvMissing.join('\n')}\n\nTimestamp: ${new Date().toISOString()}\n`
  );
  
  // Only exit with error if strict checking is enabled
  if (shouldFailBuild) {
    console.error('\n❌ Strict environment checking enabled. Failing build.');
    process.exit(1);
  } else {
    console.warn('\n⚠️ Continuing build despite missing variables (STRICT_ENV_CHECK not enabled)');
  }
} else {
  console.log('\n✅ All required environment variables are present!');
}

console.log('=============================================');
