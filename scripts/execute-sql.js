#!/usr/bin/env node
/**
 * Direct SQL execution script for remote Supabase database
 * Uses service role key for admin privileges
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database connection string
const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL (or SUPABASE_DB_URL) is required');
}

async function executeSql(sqlFile = null, sqlCommand = null) {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connecting to remote database...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    let sql;
    
    if (sqlFile) {
      // Read SQL from file
      const sqlPath = path.resolve(sqlFile);
      if (!fs.existsSync(sqlPath)) {
        throw new Error(`SQL file not found: ${sqlPath}`);
      }
      sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`📄 Executing SQL from: ${sqlFile}`);
      console.log(`📝 SQL content length: ${sql.length} characters\n`);
    } else if (sqlCommand) {
      // Use direct SQL command
      sql = sqlCommand;
      console.log(`📝 Executing SQL command:\n${sql}\n`);
    } else {
      throw new Error('Must provide either a SQL file or SQL command');
    }

    // Execute the SQL
    console.log('⚡ Executing SQL...');
    const result = await client.query(sql);
    
    // Display results
    if (result.rows && result.rows.length > 0) {
      console.log('📊 Query Results:');
      console.table(result.rows);
    } else {
      console.log(`✅ SQL executed successfully (${result.command || 'Command'} affected ${result.rowCount || 0} rows)`);
    }

    return result;
  } catch (error) {
    console.error('❌ Error executing SQL:', error.message);
    if (error.detail) {
      console.error('   Detail:', error.detail);
    }
    if (error.hint) {
      console.error('   Hint:', error.hint);
    }
    throw error;
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage:
  node scripts/execute-sql.js <sql-file>       # Execute SQL from a file
  node scripts/execute-sql.js -c "<sql>"       # Execute SQL command directly

Examples:
  node scripts/execute-sql.js supabase/migrations/20250930_professional_tools_inventory.sql
  node scripts/execute-sql.js -c "SELECT COUNT(*) FROM vehicles"
`);
    process.exit(1);
  }

  let sqlFile = null;
  let sqlCommand = null;

  if (args[0] === '-c') {
    sqlCommand = args[1];
  } else {
    sqlFile = args[0];
  }

  executeSql(sqlFile, sqlCommand)
    .then(() => {
      console.log('✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      process.exit(1);
    });
}

export { executeSql };
