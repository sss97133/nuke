# Database Connection Inspection Report

## Connection Configuration

### Supabase Client Setup
- **Location**: `nuke_frontend/src/lib/supabase.ts`
- **Client**: `@supabase/supabase-js`
- **Configuration**:
  ```typescript
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  })
  ```

### Connection Settings
- **URL**: `https://qkgaybvrernstplzjaam.supabase.co`
- **Auth**: Auto-refresh enabled, session persistence enabled
- **Realtime**: Using default settings
- **No explicit timeout/retry configuration** (using Supabase defaults)

## Current Issues

### 1. Missing Connection Options
The Supabase client is created without:
- Connection timeout settings
- Retry logic
- Connection pooling configuration
- Request timeout settings

### 2. Error Handling
- Basic error handling in place
- No retry logic for transient failures
- No connection health monitoring

### 3. Query Patterns
- Direct queries without connection pooling awareness
- No query batching
- No request deduplication

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
        'x-client-info': 'nuke-frontend'
      }
    }
  }
);
```

### 2. Add Retry Logic
Create a wrapper service with retry logic:
```typescript
async function queryWithRetry<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  retries = 3
): Promise<{ data: T | null; error: any }> {
  for (let i = 0; i < retries; i++) {
    const result = await queryFn();
    if (!result.error) return result;
    if (i < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  return { data: null, error: new Error('Query failed after retries') };
}
```

### 3. Add Connection Health Monitoring
```typescript
let lastHealthCheck = Date.now();
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

async function checkConnectionHealth(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('vehicles')
      .select('id')
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}
```

### 4. Optimize Query Patterns
- Use RPC functions for complex queries
- Batch related queries
- Use `maybeSingle()` for optional queries
- Add proper error boundaries

### 5. Add Request Deduplication
For frequently called queries, cache results:
```typescript
const queryCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds

async function cachedQuery<T>(
  key: string,
  queryFn: () => Promise<T>,
  ttl = CACHE_TTL
): Promise<T> {
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  const data = await queryFn();
  queryCache.set(key, { data, timestamp: Date.now() });
  return data;
}
```

## Connection Statistics

Run the inspection script to get current stats:
```bash
cd /Users/skylar/nuke
npx tsx scripts/inspect-db-connections.ts
```

## Monitoring

### Key Metrics to Track
1. **Connection Latency**: Should be < 500ms
2. **Error Rate**: Should be < 1%
3. **Active Connections**: Monitor pool usage
4. **Query Performance**: Track slow queries (> 1s)

### Database-Level Monitoring
```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';

-- Slow queries
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;
```

## Next Steps

1. ✅ Add connection configuration options
2. ✅ Implement retry logic wrapper
3. ✅ Add health check monitoring
4. ✅ Optimize query patterns
5. ✅ Add request caching
6. ✅ Set up connection monitoring dashboard

