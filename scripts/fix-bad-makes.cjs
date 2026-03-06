#!/usr/bin/env node
const pg = require('pg');
const client = new pg.Client({connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres'});

const MAKES = [
  'Alfa Romeo', 'Aston Martin', 'Austin-Healey', 'De Tomaso', 'Land Rover', 'Mercedes-Benz',
  'Rolls-Royce', 'AM General', 'AC', 'Acura', 'Audi', 'Austin', 'BMW', 'Bentley', 'Buick',
  'Cadillac', 'Chevrolet', 'Chrysler', 'Citroen', 'Datsun', 'DeLorean', 'Dodge', 'Ferrari',
  'Fiat', 'Ford', 'GMC', 'Honda', 'Hummer', 'Hyundai', 'Infiniti', 'International', 'Isuzu',
  'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Lancia', 'Lexus', 'Lincoln', 'Lotus',
  'Maserati', 'Mazda', 'McLaren', 'Mercury', 'MG', 'Mini', 'MINI', 'Mitsubishi', 'Nissan',
  'Oldsmobile', 'Opel', 'Pagani', 'Peugeot', 'Plymouth', 'Pontiac', 'Porsche', 'RAM',
  'Renault', 'Rivian', 'Saab', 'Saturn', 'Shelby', 'Subaru', 'Suzuki', 'Tesla',
  'Toyota', 'Triumph', 'Volkswagen', 'Volvo', 'Willys', 'Harley-Davidson',
  'Indian', 'Ducati', 'Kawasaki', 'Yamaha', 'BSA', 'Norton', 'Vespa', 'KTM',
  'DeSoto', 'Hudson', 'Kaiser', 'Nash', 'Packard', 'Studebaker',
  'Sunbeam', 'TVR', 'Pantera', 'Avanti', 'Bricklin', 'Excalibur',
  'Daimler', 'Jensen', 'Morgan', 'Riley', 'Rover', 'Singer', 'Wolseley',
  'Daewoo', 'Genesis', 'Abarth', 'Alpine', 'Bugatti', 'DS', 'Polestar', 'Smart',
];

// Sort by length descending so multi-word makes match first
MAKES.sort((a, b) => b.length - a.length);

function findMakeInString(str) {
  const lower = str.toLowerCase();
  for (const make of MAKES) {
    const idx = lower.indexOf(make.toLowerCase() + ' ');
    if (idx !== -1) {
      const afterMake = str.slice(idx + make.length).trim();
      return { make, model: afterMake, idx };
    }
    // Also check if make is at end of string
    if (lower.endsWith(make.toLowerCase())) {
      return { make, model: '', idx: lower.indexOf(make.toLowerCase()) };
    }
  }
  return null;
}

async function run() {
  await client.connect();

  const BAD_MAKE_PATTERN = `make ~ E'^\\d+[kK]?-?(Mile|Year|Owner|Hour)' OR make ~ E'^(No.Reserve|Modified|Turbocharged|Supercharged|Fuel.Injected|Original.Owner|One.Owner|Euro|Single)'`;

  const result = await client.query(`
    SELECT id, year, make, model FROM vehicles
    WHERE deleted_at IS NULL
      AND NOT (model ~ E'^[0-9]{4} ')
      AND (${BAD_MAKE_PATTERN})
  `);

  console.log(`Found ${result.rows.length} records with bad makes`);

  let fixed = 0, skipped = 0;

  for (const row of result.rows) {
    const found = findMakeInString(row.model);
    if (found && found.model) {
      await client.query(
        'UPDATE vehicles SET make = $1, model = $2, updated_at = NOW() WHERE id = $3',
        [found.make, found.model, row.id]
      );
      fixed++;
      if (fixed % 500 === 0) console.log(`Fixed ${fixed}...`);
    } else {
      skipped++;
      if (skipped <= 10) console.log(`SKIP: make="${row.make}" model="${row.model}"`);
    }

    if ((fixed + skipped) % 1000 === 0) {
      await client.query('SELECT pg_sleep(0.05)');
    }
  }

  console.log(`DONE: Fixed ${fixed}, skipped ${skipped}`);
  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
