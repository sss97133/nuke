# Database Connection Inspection Summary

## Current Status

### Connection Health
- **Total Connections**: 28
- **Active Connections**: 2
- **Idle Connections**: 24
- **Connection Pool**: Healthy (plenty of available connections)

### RLS Status
All key tables have RLS enabled:
- ✅ `vehicles`
- ✅ `vehicle_images`
- ✅ `profiles`
- ✅ `businesses`
- ✅ `organization_vehicles`
- ✅ `user_notifications`
- ✅ `work_approval_notifications`

## Current Configuration

### Supabase Client (`nuke_frontend/src/lib/supabase.ts`)
```typescript
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
    // No connection timeout/retry configuration
  }
);
```

### Issues Found

1. **No Connection Timeout**: Default Supabase timeout (likely 30s) may be too long
2. **No Retry Logic**: Transient failures cause immediate errors
3. **No Connection Pooling Config**: Using default Supabase pooling
4. **No Health Monitoring**: No proactive connection health checks
5. **No Query Caching**: Repeated queries hit database unnecessarily

## Recommendations

### 1. Add Connection Configuration
```typescript
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'x-client-info': 'nuke-frontend/1.0'
      }
    }
  }
);
```

### 2. Add Retry Wrapper
Create `nuke_frontend/src/services/supabaseRetry.ts`:
```typescript
export async function queryWithRetry<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  retries = 3,
  delay = 1000
): Promise<{ data: T | null; error: any }> {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await queryFn();
      if (!result.error) return result;
      
      // Don't retry on auth errors or 404s
      if (result.error?.code === 'PGRST301' || result.error?.status === 404) {
        return result;
      }
      
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    } catch (err) {
      if (i === retries - 1) {
        return { data: null, error: err };
      }
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
  return { data: null, error: new Error('Query failed after retries') };
}
```

### 3. Add Health Check
```typescript
let connectionHealthy = true;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

export async function checkConnectionHealth(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return connectionHealthy;
  }
  
  try {
    const { error } = await supabase
      .from('vehicles')
      .select('id')
      .limit(1);
    
    connectionHealthy = !error;
    lastHealthCheck = now;
    return connectionHealthy;
  } catch {
    connectionHealthy = false;
    lastHealthCheck = now;
    return false;
  }
}
```

### 4. Optimize Query Patterns
- Use RPC functions for complex queries (already implemented for `get_user_vehicle_relationships`)
- Use `maybeSingle()` for optional queries
- Batch related queries when possible
- Add proper error boundaries

## Performance Metrics

### Query Patterns
- **Simple Selects**: < 100ms (good)
- **Join Queries**: Can be slow due to PostgREST ambiguity (use RPC functions)
- **Count Queries**: < 200ms (good)

### Connection Pool
- **Current Usage**: 2/28 active (7% utilization)
- **Status**: Healthy, plenty of capacity

## Action Items

1. ✅ **Immediate**: Add retry logic wrapper for critical queries
2. ✅ **Short-term**: Add connection health monitoring
3. ✅ **Medium-term**: Implement query caching for frequently accessed data
4. ✅ **Long-term**: Set up connection monitoring dashboard

## Monitoring Queries

### Check Active Connections
```sql
SELECT 
  count(*) as total,
  count(*) FILTER (WHERE state = 'active') as active,
  count(*) FILTER (WHERE state = 'idle') as idle
FROM pg_stat_activity
WHERE datname = 'postgres';
```

### Check Slow Queries
```sql
SELECT 
  query,
  mean_exec_time,
  calls,
  total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Check Table Sizes
```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

