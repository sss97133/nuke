// Simple Supabase connection test script (ES Module version)
import { exec } from 'child_process';
import http from 'http';
import { createServer } from 'http';

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
    
    req.setTimeout(1000, () => {
      req.destroy();
      resolve({ port, inUse: false, timeout: true });
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
  
  // Environment variables would normally be available in process.env but may not be in this context
  console.log('\n🔄 Other troubleshooting checks...');
  console.log('Check for any port conflicts:');
  console.log('  Run: lsof -i :54321-54324');
  
  console.log('\n💡 Recommendation: If services are running but not accessible, try:');
  console.log('1. Stop Supabase: npx supabase stop');
  console.log('2. Start Supabase again: npx supabase start');
  console.log('3. Make sure your .env file has these variables:');
  console.log('   VITE_SUPABASE_URL=http://127.0.0.1:54321');
  console.log('   VITE_SUPABASE_ANON_KEY=[your-anon-key]');
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
    
    req.setTimeout(2000, () => {
      req.destroy();
      console.log(`${serviceName}: ❌ Timeout after 2 seconds`);
      resolve(false);
    });
    
    req.end();
  });
}

// Run checks and create a simple status page
async function runDiagnostics() {
  // Run Supabase health checks
  await checkSupabaseHealth();
  
  // Create a local web server to show results
  console.log('\n📊 Creating diagnostic web page on port 3333...');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Nuke Diagnostics</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            h1 { color: #333; }
            .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 16px 0; }
            .status { display: inline-block; padding: 4px 8px; border-radius: 4px; margin-right: 8px; }
            .success { background: #d4edda; color: #155724; }
            .error { background: #f8d7da; color: #721c24; }
            .pending { background: #fff3cd; color: #856404; }
            pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }
            button { background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
            button:hover { background: #0069d9; }
          </style>
        </head>
        <body>
          <h1>Nuke Local Development Diagnostics</h1>
          
          <div class="card">
            <h2>Supabase Status</h2>
            <p>Check if Supabase services are running and accessible:</p>
            <ul>
              <li>Auth Service: <span class="status pending">Checking...</span></li>
              <li>Database (PostgreSQL): <span class="status pending">Checking...</span></li>
              <li>REST API: <span class="status pending">Checking...</span></li>
              <li>Storage: <span class="status pending">Checking...</span></li>
            </ul>
            <button id="check-supabase">Re-Check Services</button>
          </div>
          
          <div class="card">
            <h2>Environment Variables</h2>
            <p>Check if required environment variables are set:</p>
            <pre id="env-vars">Checking...</pre>
            <button id="check-env">Check Environment</button>
          </div>
          
          <div class="card">
            <h2>Troubleshooting</h2>
            <p>Common fixes:</p>
            <ol>
              <li>Stop Supabase: <code>npx supabase stop</code></li>
              <li>Start Supabase again: <code>npx supabase start</code></li>
              <li>Check for port conflicts: <code>lsof -i :54321-54324</code></li>
              <li>Verify your <code>.env</code> file has the correct variables</li>
            </ol>
          </div>
          
          <script>
            // Simple placeholder for the diagnostic page
            // In a real implementation, this would make fetch requests to check services
            document.getElementById('check-supabase').addEventListener('click', () => {
              alert('This is a placeholder diagnostic page. Run the actual checks from your terminal.');
            });
            
            document.getElementById('check-env').addEventListener('click', () => {
              alert('This is a placeholder diagnostic page. Check your environment variables in your terminal.');
            });
          </script>
        </body>
      </html>
    `);
  });
  
  server.listen(3333, () => {
    console.log('Diagnostic page available at: http://localhost:3333');
    console.log('Press Ctrl+C to exit');
  });
}

runDiagnostics();
