#!/usr/bin/env node
const pg = require('pg');
const client = new pg.Client({connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres'});

const MAKES = [
  'Alfa Romeo', 'Aston Martin', 'Austin-Healey', 'De Tomaso', 'Land Rover', 'Mercedes-Benz',
  'Rolls-Royce', 'AC', 'Acura', 'Audi', 'Austin', 'BMW', 'Bentley', 'Buick', 'Cadillac',
  'Chevrolet', 'Chrysler', 'Citroen', 'Datsun', 'DeLorean', 'Dodge', 'Ferrari', 'Fiat',
  'Ford', 'GMC', 'Honda', 'Hummer', 'Hyundai', 'Infiniti', 'International', 'Isuzu',
  'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Lancia', 'Lexus', 'Lincoln', 'Lotus',
  'Maserati', 'Mazda', 'McLaren', 'Mercury', 'MG', 'Mini', 'MINI', 'Mitsubishi', 'Nissan',
  'Oldsmobile', 'Opel', 'Pagani', 'Peugeot', 'Plymouth', 'Pontiac', 'Porsche', 'RAM',
  'Renault', 'Rivian', 'Saab', 'Saturn', 'Shelby', 'Subaru', 'Suzuki', 'Tesla',
  'Toyota', 'Triumph', 'Volkswagen', 'Volvo', 'Willys', 'Harley-Davidson',
  'Indian', 'Ducati', 'Kawasaki', 'Yamaha', 'BSA', 'Norton', 'Vespa', 'KTM',
  'AM General', 'DeSoto', 'Hudson', 'Kaiser', 'Nash', 'Packard', 'Studebaker',
  'Sunbeam', 'TVR', 'Pantera', 'Avanti', 'Bricklin', 'Excalibur',
  'Daimler', 'Jensen', 'Morgan', 'Riley', 'Rover', 'Singer', 'Wolseley',
  'Daewoo', 'Genesis', 'Abarth', 'Alpine', 'Bugatti', 'DS', 'Polestar', 'Smart',
];

function parseTitle(title) {
  const m = title.match(/^(\d{4}(?:\.5)?)\s+(.+)/);
  if (!m) return null;
  const year = parseInt(m[1]);
  const rest = m[2];
  for (const make of MAKES) {
    if (rest.toLowerCase().startsWith(make.toLowerCase() + ' ') || rest.toLowerCase() === make.toLowerCase()) {
      const model = rest.slice(make.length).trim();
      return { year, make, model: model || rest };
    }
  }
  const words = rest.split(/\s+/);
  if (words.length >= 2) return { year, make: words[0], model: words.slice(1).join(' ') };
  return null;
}

async function run() {
  await client.connect();
  let totalFixed = 0;
  let batchNum = 0;

  while (true) {
    const batch = await client.query(`SELECT id, year, make, model FROM vehicles WHERE model ~ E'^[0-9]{4} ' AND deleted_at IS NULL LIMIT 1000`);
    if (batch.rows.length === 0) break;
    batchNum++;
    let fixed = 0;

    for (const row of batch.rows) {
      const parsed = parseTitle(row.model);
      if (!parsed) continue;

      const isBadMake = /^\d+[kK]?-?(Mile|Year|Owner|Hour)/i.test(row.make) ||
        /^(No.Reserve|Modified|Turbocharged|Supercharged|Fuel.Injected|Original.Owner|One.Owner|Euro|Single)/i.test(row.make);

      if (isBadMake) {
        await client.query('UPDATE vehicles SET make = $1, model = $2, updated_at = NOW() WHERE id = $3', [parsed.make, parsed.model, row.id]);
      } else {
        await client.query('UPDATE vehicles SET model = $1, updated_at = NOW() WHERE id = $2', [parsed.model, row.id]);
      }
      fixed++;
    }

    totalFixed += fixed;
    if (batchNum % 10 === 0) console.log(`Batch ${batchNum}: ${totalFixed} fixed`);
    await client.query('SELECT pg_sleep(0.05)');
  }

  console.log(`DONE: Fixed ${totalFixed} records in ${batchNum} batches`);
  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
