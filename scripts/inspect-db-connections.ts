/**
 * Database Connection Inspector
 * 
 * Inspects all database connections from UI to Supabase:
 * - Connection configuration
 * - Health checks
 * - Query patterns
 * - Performance metrics
 * - RLS policies
 * - Error handling
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface ConnectionDiagnostic {
  timestamp: string;
  connectionConfig: {
    url: string;
    keyPresent: boolean;
    keyLength: number;
    authConfig: any;
  };
  healthCheck: {
    status: 'healthy' | 'degraded' | 'failed';
    latency: number;
    error?: string;
  };
  queryPatterns: {
    table: string;
    count: number;
    avgLatency: number;
    errors: number;
  }[];
  rlsStatus: {
    table: string;
    enabled: boolean;
    policies: number;
  }[];
  recommendations: string[];
}

async function inspectConnections(): Promise<ConnectionDiagnostic> {
  const diagnostic: ConnectionDiagnostic = {
    timestamp: new Date().toISOString(),
    connectionConfig: {
      url: supabaseUrl,
      keyPresent: !!supabaseAnonKey,
      keyLength: supabaseAnonKey?.length || 0,
      authConfig: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    },
    healthCheck: {
      status: 'failed',
      latency: 0
    },
    queryPatterns: [],
    rlsStatus: [],
    recommendations: []
  };

  console.log('🔍 Inspecting Database Connections...\n');

  // 1. Connection Configuration
  console.log('📋 Connection Configuration:');
  console.log(`   URL: ${supabaseUrl}`);
  console.log(`   Key Present: ${diagnostic.connectionConfig.keyPresent}`);
  console.log(`   Key Length: ${diagnostic.connectionConfig.keyLength}`);
  console.log(`   Auth: Auto-refresh=${diagnostic.connectionConfig.authConfig.autoRefreshToken}, Persist=${diagnostic.connectionConfig.authConfig.persistSession}\n`);

  // 2. Health Check
  console.log('🏥 Health Check:');
  const healthStart = Date.now();
  try {
    const { data, error, count } = await supabase
      .from('vehicles')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    
    const latency = Date.now() - healthStart;
    diagnostic.healthCheck = {
      status: error ? 'failed' : 'healthy',
      latency,
      error: error?.message
    };
    
    console.log(`   Status: ${diagnostic.healthCheck.status}`);
    console.log(`   Latency: ${latency}ms`);
    if (error) {
      console.log(`   Error: ${error.message}`);
      console.log(`   Code: ${error.code}`);
      console.log(`   Details: ${error.details}`);
    } else {
      console.log(`   ✅ Connection successful`);
    }
  } catch (err: any) {
    diagnostic.healthCheck = {
      status: 'failed',
      latency: Date.now() - healthStart,
      error: err.message
    };
    console.log(`   ❌ Connection failed: ${err.message}`);
  }
  console.log('');

  // 3. Test Common Tables
  console.log('📊 Testing Common Tables:');
  const commonTables = [
    'vehicles',
    'vehicle_images',
    'profiles',
    'businesses',
    'organization_vehicles',
    'user_notifications',
    'work_approval_notifications'
  ];

  for (const table of commonTables) {
    const start = Date.now();
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .limit(1);
      
      const latency = Date.now() - start;
      const status = error ? '❌' : '✅';
      
      console.log(`   ${status} ${table.padEnd(30)} ${latency}ms ${error ? `(${error.code})` : ''}`);
      
      diagnostic.queryPatterns.push({
        table,
        count: count || 0,
        avgLatency: latency,
        errors: error ? 1 : 0
      });
    } catch (err: any) {
      console.log(`   ❌ ${table.padEnd(30)} Error: ${err.message}`);
      diagnostic.queryPatterns.push({
        table,
        count: 0,
        avgLatency: Date.now() - start,
        errors: 1
      });
    }
  }
  console.log('');

  // 4. Check RLS Status
  console.log('🔒 RLS Policy Status:');
  const rlsTables = ['vehicles', 'vehicle_images', 'profiles', 'businesses', 'organization_vehicles'];
  
  for (const table of rlsTables) {
    try {
      // Try to query with RLS - if it fails with permission error, RLS is enabled
      const { error } = await supabase
        .from(table)
        .select('id')
        .limit(0);
      
      // Check if RLS is enabled by querying pg_policies
      const { data: policies } = await supabase.rpc('get_table_policies', { table_name: table }).catch(() => ({ data: null }));
      
      diagnostic.rlsStatus.push({
        table,
        enabled: true, // Assume enabled if we can't query without auth
        policies: policies ? (policies as any[]).length : 0
      });
      
      console.log(`   ${table.padEnd(30)} RLS: ${error?.code === 'PGRST301' ? 'Enabled' : 'Unknown'} ${policies ? `(${(policies as any[]).length} policies)` : ''}`);
    } catch (err: any) {
      console.log(`   ${table.padEnd(30)} Error checking RLS`);
    }
  }
  console.log('');

  // 5. Performance Metrics
  console.log('⚡ Performance Metrics:');
  const performanceTests = [
    { name: 'Simple Select', query: () => supabase.from('vehicles').select('id').limit(10) },
    { name: 'Join Query', query: () => supabase.from('vehicles').select('id, vehicle_images(id)').limit(5) },
    { name: 'Count Query', query: () => supabase.from('vehicles').select('*', { count: 'exact', head: true }) }
  ];

  for (const test of performanceTests) {
    const start = Date.now();
    try {
      await test.query();
      const latency = Date.now() - start;
      console.log(`   ${test.name.padEnd(20)} ${latency}ms`);
    } catch (err: any) {
      console.log(`   ${test.name.padEnd(20)} Failed: ${err.message}`);
    }
  }
  console.log('');

  // 6. Recommendations
  console.log('💡 Recommendations:');
  
  if (diagnostic.healthCheck.latency > 1000) {
    diagnostic.recommendations.push('High latency detected - consider connection pooling or query optimization');
    console.log('   ⚠️  High latency detected - consider connection pooling');
  }
  
  if (diagnostic.queryPatterns.some(q => q.errors > 0)) {
    diagnostic.recommendations.push('Some tables have query errors - check RLS policies and table existence');
    console.log('   ⚠️  Some tables have query errors - check RLS policies');
  }
  
  if (!diagnostic.connectionConfig.keyPresent) {
    diagnostic.recommendations.push('Missing Supabase anon key - connection will fail');
    console.log('   ❌ Missing Supabase anon key');
  }
  
  if (diagnostic.healthCheck.status === 'healthy') {
    console.log('   ✅ Connection is healthy');
  }

  return diagnostic;
}

// Run inspection
inspectConnections()
  .then(diagnostic => {
    console.log('\n📝 Diagnostic Summary:');
    console.log(JSON.stringify(diagnostic, null, 2));
  })
  .catch(err => {
    console.error('❌ Inspection failed:', err);
    process.exit(1);
  });

