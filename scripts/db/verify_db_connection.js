const https = require('https');

const url = 'https://fspbjrzdulesxohceznc.supabase.co/rest/v1/vehicles?select=id&limit=1';
const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzcGJqcnpkdWxlc3hvaGNlem5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ0OTkwMzcsImV4cCI6MjA1MDA3NTAzN30.kzmRCkfp4zcCqEL8VEaR_sSTyWFwwoNWyVVLKWCK-g0';

const options = {
  headers: {
    'apikey': apiKey,
    'Authorization': `Bearer ${apiKey}`
  }
};

https.get(url, options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ Database connection successful');
      console.log('Response:', data);
    } else {
      console.log('❌ Database connection failed');
      console.log('Status:', res.statusCode);
      console.log('Response:', data);
    }
  });
}).on('error', (err) => {
  console.error('❌ Connection error:', err.message);
});
