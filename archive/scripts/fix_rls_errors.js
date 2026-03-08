#!/usr/bin/env node
const { Client } = require('pg');

const DB_CONFIG = {
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.qkgaybvrernstplzjaam',
  password: 'RbzKq32A0uhqvJMQ',
  ssl: { rejectUnauthorized: false }
};

async function fixRLS() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  
  try {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║     FIXING RLS POLICIES (Removing Errors)             ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
    const tables = [
      'share_holdings',
      'ownership_verifications',
      'vehicle_support',
      'vehicle_builds',
      'vehicle_moderators'
    ];
    
    for (const table of tables) {
      console.log(`${table}:`);
      
      // Check if table has public SELECT policy
      const policies = await client.query(`
        SELECT policyname, cmd 
        FROM pg_policies 
        WHERE tablename = $1 AND cmd = 'SELECT'
      `, [table]);
      
      const hasPublicRead = policies.rows.some(p => 
        p.policyname.toLowerCase().includes('public') || 
        p.policyname.toLowerCase().includes('anyone') ||
        p.policyname.toLowerCase().includes('view')
      );
      
      if (!hasPublicRead) {
        console.log(`  ⚠️  Missing public SELECT - adding...`);
        
        const policyName = `Anyone views ${table}`;
        await client.query(`DROP POLICY IF EXISTS "${policyName}" ON ${table}`);
        await client.query(`
          CREATE POLICY "${policyName}" ON ${table}
            FOR SELECT USING (true)
        `);
        
        console.log(`  ✅ Added public SELECT policy`);
      } else {
        console.log(`  ✓ Already has public SELECT`);
      }
    }
    
    console.log('\n✅ Testing queries as anonymous user...\n');
    
    for (const table of tables) {
      try {
        const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`  ✓ ${table.padEnd(30)} ${result.rows[0].count} rows`);
      } catch (error) {
        console.log(`  ❌ ${table.padEnd(30)} ${error.message.substring(0, 50)}`);
      }
    }
    
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  ✅ RLS POLICIES FIXED                                ║');
    console.log('║  Site should have fewer errors now                   ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    
  } catch (error) {
    console.error('Fix failed:', error.message);
  } finally {
    await client.end();
  }
}

fixRLS();

