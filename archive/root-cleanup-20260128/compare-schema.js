const fs = require('fs');
const path = require('path');

// Tables found in remote
const remoteTables = [
  'vehicles', 'profiles', 'timeline_events', 'shops',
  'organizations', 'vehicle_images', 'receipts',
  'duplicate_detections', 'vehicle_location_observations', 'auction_events'
];

// Read all migration files and extract CREATE TABLE statements
const migrationsDir = path.join(__dirname, 'supabase', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

const tablesInMigrations = new Set();

migrationFiles.forEach(file => {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

  // Match CREATE TABLE statements (multiple patterns)
  const patterns = [
    /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([^\s(]+)/gi,
    /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?public\.([^\s(]+)/gi
  ];

  patterns.forEach(pattern => {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      let tableName = match[1].replace('public.', '').replace(';', '');
      tablesInMigrations.add(tableName);
    }
  });
});

console.log('📊 SCHEMA COMPARISON REPORT');
console.log('=' .repeat(50));

console.log('\n✅ Tables in REMOTE database:');
remoteTables.forEach(t => console.log(`  - ${t}`));

console.log('\n📄 Tables defined in MIGRATIONS:');
[...tablesInMigrations].sort().forEach(t => console.log(`  - ${t}`));

console.log('\n⚠️  Tables in MIGRATIONS but NOT in REMOTE:');
const missingInRemote = [...tablesInMigrations].filter(t => !remoteTables.includes(t));
if (missingInRemote.length === 0) {
  console.log('  None - all migration tables exist remotely');
} else {
  missingInRemote.forEach(t => console.log(`  ❌ ${t}`));
}

console.log('\n⚠️  Tables in REMOTE but NOT in MIGRATIONS:');
const missingInMigrations = remoteTables.filter(t => !tablesInMigrations.has(t));
if (missingInMigrations.length === 0) {
  console.log('  None - all remote tables have migrations');
} else {
  missingInMigrations.forEach(t => console.log(`  ❌ ${t}`));
}

console.log('\n' + '=' .repeat(50));
console.log('Summary:');
console.log(`  Remote tables: ${remoteTables.length}`);
console.log(`  Migration tables: ${tablesInMigrations.size}`);
console.log(`  Missing in remote: ${missingInRemote.length}`);
console.log(`  Missing in migrations: ${missingInMigrations.length}`);