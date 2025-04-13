// Simple PostgreSQL connection tester
const { Client } = require('pg');

// Create a PostgreSQL client with the Supabase connection details
const client = new Client({
  user: 'postgres',
  host: '127.0.0.1',
  database: 'postgres',
  password: 'postgres',
  port: 54322,
});

console.log('🔍 Testing direct PostgreSQL connection to Supabase...');

// Attempt to connect to the database
client.connect()
  .then(() => {
    console.log('✅ Successfully connected to PostgreSQL');
    
    // Run a simple query to verify full functionality
    return client.query('SELECT current_timestamp as current_time');
  })
  .then(result => {
    console.log('✅ Query successful:', result.rows[0]);
    client.end();
  })
  .catch(err => {
    console.error('❌ PostgreSQL connection error:', err.message);
    if (err.code) {
      console.error('Error code:', err.code);
    }
    if (client) {
      client.end();
    }
  });
