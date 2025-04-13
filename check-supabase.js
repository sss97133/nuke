// Simple Supabase connection test script
import { exec } from 'child_process';
import http from 'http';

console.log('🔍 Checking Supabase services...');

// Check if ports are in use
function checkPort(port) {
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

async function checkSupabaseHealth() {
  // Check main Supabase ports
  const ports = [54321, 54322, 54323, 54324];
  const results = [];
  
  console.log('📊 Checking critical ports...');
  for (const port of ports) {
    const result = await checkPort(port);
    results.push(result);
    console.log(`Port ${port}: ${result.inUse ? '✅ In use' : '❌ Not responding'}`);
  }
  
  // Check services
  if (results[0].inUse) {
    console.log('\n🔄 Testing Supabase API connection...');
    await testConnection('http://localhost:54321/auth/v1/health', 'Auth service');
    await testConnection('http://localhost:54321/rest/v1/', 'REST API');
    await testConnection('http://localhost:54321/storage/v1/health', 'Storage service');
  } else {
    console.log('\n❌ Main Supabase API (port 54321) not responding - check if service is running.');
  }
  
  // Check for database connection
  if (results[1].inUse) {
    console.log('\n🔄 Testing PostgreSQL connection...');
    exec('nc -z localhost 54322', (error) => {
      console.log(`PostgreSQL: ${error ? '❌ Connection failed' : '✅ Connection successful'}`);
    });
  } else {
    console.log('\n❌ PostgreSQL (port 54322) not responding - check if service is running.');
  }
  
  // Check environment variables
  console.log('\n🔄 Checking environment variables...');
  checkEnvVar('VITE_SUPABASE_URL');
  checkEnvVar('VITE_SUPABASE_ANON_KEY');
  
  console.log('\n💡 Recommendation: If services are running but not accessible, try:');
  console.log('1. Stop Supabase: npx supabase stop');
  console.log('2. Start Supabase again: npx supabase start');
  console.log('3. Check for port conflicts: lsof -i :54321-54324');
}

function checkEnvVar(name) {
  const value = process.env[name];
  console.log(`${name}: ${value ? '✅ Set' : '❌ Not set'}`);
}

function testConnection(url, serviceName) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'GET' }, (res) => {
      console.log(`${serviceName}: ✅ Responding (Status: ${res.statusCode})`);
      resolve(true);
    });
    
    req.on('error', (error) => {
      console.log(`${serviceName}: ❌ Error (${error.message})`);
      resolve(false);
    });
    
    req.end();
  });
}

checkSupabaseHealth();
