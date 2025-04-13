#!/usr/bin/env node

import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * This script helps diagnose and fix common Supabase connection issues for local development
 */

console.log('🔧 Supabase Helper Tool 🔧');
console.log('============================\n');

// Check if Supabase ports are in use
async function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.request({
      method: 'HEAD',
      host: 'localhost',
      port
    }, (res) => {
      resolve({ port, inUse: true, status: res.statusCode });
    });
    
    req.on('error', () => {
      resolve({ port, inUse: false });
    });
    
    req.end();
  });
}

// Check Supabase auth service health
async function checkAuthHealth() {
  return new Promise((resolve) => {
    const req = http.request({
      method: 'GET',
      host: 'localhost',
      port: 54321,
      path: '/auth/v1/health'
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ 
          status: res.statusCode, 
          ok: res.statusCode === 200,
          data: data 
        });
      });
    });
    
    req.on('error', (err) => {
      resolve({ status: 0, ok: false, error: err.message });
    });
    
    req.end();
  });
}

// Generate HTML file with instructions to remove local storage
function createAuthClearerHtml() {
  const htmlPath = path.join(__dirname, 'clear-auth.html');
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Clear Supabase Auth</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
    }
    .button {
      background-color: #4CAF50;
      border: none;
      color: white;
      padding: 15px 32px;
      text-align: center;
      text-decoration: none;
      display: inline-block;
      font-size: 16px;
      margin: 4px 2px;
      cursor: pointer;
      border-radius: 4px;
    }
    .button:hover {
      background-color: #45a049;
    }
    pre {
      background-color: #f5f5f5;
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
    }
    .alert {
      padding: 20px;
      background-color: #f44336;
      color: white;
      margin-bottom: 15px;
      border-radius: 4px;
    }
    .success {
      padding: 20px;
      background-color: #4CAF50;
      color: white;
      margin-bottom: 15px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <h1>Supabase Auth Clearer</h1>
  <p>This tool will help you clear any existing Supabase authentication tokens from your browser's local storage.</p>
  
  <h2>Step 1: Clear Local Storage</h2>
  <button class="button" id="clearAuthBtn">Clear Supabase Auth Tokens</button>
  <div id="clearResult"></div>
  
  <h2>Step 2: Check Login Page</h2>
  <p>After clearing the tokens, visit your login page to see if the login buttons appear:</p>
  <button class="button" id="loginPageBtn">Open Login Page</button>
  
  <h2>Supabase Connection Status</h2>
  <div id="connectionStatus">Checking...</div>
  
  <h2>Troubleshooting Guide</h2>
  <h3>Common Issues and Fixes:</h3>
  <ol>
    <li>
      <strong>Port conflicts:</strong>
      <pre>docker ps | grep supabase</pre>
      <pre>lsof -i :54321-54324</pre>
    </li>
    <li>
      <strong>Restart Supabase:</strong>
      <pre>supabase stop && supabase start</pre>
    </li>
    <li>
      <strong>Check if Supabase is properly initialized:</strong>
      <pre>supabase status</pre>
    </li>
  </ol>
  
  <script>
    // Clear Supabase auth tokens
    document.getElementById('clearAuthBtn').addEventListener('click', function() {
      let cleared = 0;
      let total = 0;
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        total++;
        if (key && key.startsWith('sb-')) {
          console.log('Removing: ' + key);
          localStorage.removeItem(key);
          cleared++;
        }
      }
      
      const resultDiv = document.getElementById('clearResult');
      if (cleared > 0) {
        resultDiv.innerHTML = '<div class="success">Successfully cleared ' + cleared + ' Supabase authentication tokens!</div>';
      } else {
        resultDiv.innerHTML = '<div class="alert">No Supabase authentication tokens found in local storage.</div>';
      }
    });
    
    // Open login page
    document.getElementById('loginPageBtn').addEventListener('click', function() {
      // Try to open the login page - this assumes a typical Vite dev server port
      window.open('http://localhost:5173/login', '_blank');
    });
    
    // Check Supabase connection
    async function checkConnection() {
      const statusDiv = document.getElementById('connectionStatus');
      
      try {
        // Check AUTH endpoint
        const authResp = await fetch('http://localhost:54321/auth/v1/health');
        const authOk = authResp.ok;
        
        // Check REST API endpoint
        const restResp = await fetch('http://localhost:54321/rest/v1/');
        const restOk = restResp.ok;
        
        if (authOk && restOk) {
          statusDiv.innerHTML = '<div class="success">✅ Supabase is running correctly! Both Auth and REST API are responding.</div>';
        } else {
          statusDiv.innerHTML = '<div class="alert">⚠️ Supabase seems to be running but with issues:<br>' +
            'Auth service: ' + (authOk ? '✅' : '❌') + '<br>' +
            'REST API: ' + (restOk ? '✅' : '❌') + '</div>';
        }
      } catch (error) {
        statusDiv.innerHTML = '<div class="alert">❌ Cannot connect to Supabase at localhost:54321<br>' +
          'Error: ' + error.message + '<br><br>' +
          'Make sure Supabase is running locally.</div>';
      }
    }
    
    // Run the connection check when page loads
    checkConnection();
  </script>
</body>
</html>
  `;
  
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

async function main() {
  console.log('1️⃣ Checking if Supabase is running...');
  
  try {
    // Check if Docker is running Supabase containers
    try {
      const dockerPs = execSync('docker ps | grep supabase').toString();
      console.log('✅ Found Supabase Docker containers:\n');
      console.log(dockerPs);
    } catch (e) {
      console.log('⚠️ No Supabase Docker containers found running.');
      console.log('   You may need to start Supabase with: supabase start\n');
    }
    
    // Check key ports
    const ports = await Promise.all([
      checkPort(54321), // API gateway
      checkPort(54322), // Studio
      checkPort(54323), // Inbucket
      checkPort(54324), // DB
    ]);
    
    console.log('2️⃣ Checking Supabase ports:');
    ports.forEach(port => {
      console.log(`Port ${port.port}: ${port.inUse ? '✅ In use' : '❌ Not in use'}`);
    });
    
    // Check auth health specifically
    const authHealth = await checkAuthHealth();
    console.log('\n3️⃣ Checking Supabase Auth service:');
    if (authHealth.ok) {
      console.log('✅ Auth service is healthy!');
    } else {
      console.log(`❌ Auth service check failed: ${authHealth.status}`);
      if (authHealth.error) {
        console.log(`   Error: ${authHealth.error}`);
      }
    }
    
    // Create HTML file for clearing auth tokens
    console.log('\n4️⃣ Creating auth token clearer...');
    const htmlPath = createAuthClearerHtml();
    console.log(`✅ Created auth clearer at: ${htmlPath}`);
    console.log(`\n🎉 NEXT STEPS: Open this file in your browser to clear auth tokens:`);
    console.log(`   file://${htmlPath}`);
    
    console.log('\n5️⃣ Quick fix commands:');
    console.log('• Restart Supabase:        supabase stop && supabase start');
    console.log('• Check port conflicts:    lsof -i :54321-54324');
    console.log('• Verify auth service:     curl http://localhost:54321/auth/v1/health');
  } catch (error) {
    console.error('❌ Error running diagnostics:', error);
  }
}

main();
