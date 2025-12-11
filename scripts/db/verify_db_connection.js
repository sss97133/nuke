require('dotenv').config();
const https = require('https');

const url = `${process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://fspbjrzdulesxohceznc.supabase.co'}/rest/v1/vehicles?select=id&limit=1`;
const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

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
