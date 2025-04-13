import { getSupabaseClient } from '@/integrations/supabase/client';

interface HealthStatus {
  database: 'healthy' | 'degraded' | 'unavailable';
  auth: 'healthy' | 'degraded' | 'unavailable';
  storage: 'healthy' | 'degraded' | 'unavailable';
  lastChecked: Date;
}

// Initialize with unavailable status and epoch date
let cachedStatus: HealthStatus = {
  database: 'unavailable',
  auth: 'unavailable',
  storage: 'unavailable',
  lastChecked: new Date(0) 
};

// Simple health check table assumed to exist: 
// CREATE TABLE public.health_check (id int primary key, status text);
// INSERT INTO public.health_check (id, status) VALUES (1, 'ok');

export const checkSupabaseHealth = async (): Promise<HealthStatus> => {
  const supabase = getSupabaseClient();
  const now = new Date();
  
  // Throttle checks to avoid excessive requests (e.g., once per minute)
  const CHECK_INTERVAL_MS = 60000; 
  if (now.getTime() - cachedStatus.lastChecked.getTime() < CHECK_INTERVAL_MS) {
    return cachedStatus;
  }
  
  const newStatus: HealthStatus = {
    database: 'unavailable',
    auth: 'unavailable',
    storage: 'unavailable',
    lastChecked: now
  };
  
  const timeoutPromise = (ms: number) => new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Health check timed out')), ms)
  );
  const HEALTH_CHECK_TIMEOUT_MS = 5000;

  // --- Check Database --- 
  try {
    const start = Date.now();
    // Assumes a simple 'health_check' table exists for a quick query
    const dbQuery = supabase.from('health_check').select('id').limit(1);
    const { error } = await Promise.race([dbQuery, timeoutPromise(HEALTH_CHECK_TIMEOUT_MS)]) as { data: any, error: any };
    const duration = Date.now() - start;
    
    if (error) {
      console.warn('Database health check failed:', error);
      newStatus.database = 'unavailable';
    } else if (duration > HEALTH_CHECK_TIMEOUT_MS / 2) { // Consider degraded if > half timeout
      console.warn(`Database health check degraded: took ${duration}ms`);
      newStatus.database = 'degraded';
    } else {
      newStatus.database = 'healthy';
    }
  } catch (err) {
    console.error('Database health check exception:', err);
    newStatus.database = 'unavailable'; // Ensure status is unavailable on exception
  }
  
  // --- Check Auth --- 
  try {
    const authQuery = supabase.auth.getSession();
    const { error } = await Promise.race([authQuery, timeoutPromise(HEALTH_CHECK_TIMEOUT_MS)]) as { data: any, error: any };
    newStatus.auth = error ? 'unavailable' : 'healthy';
    if (error) console.warn('Auth health check failed:', error);
  } catch (err) {
    console.error('Auth health check exception:', err);
    newStatus.auth = 'unavailable';
  }
  
  // --- Check Storage --- 
  try {
    // Check a known bucket, e.g., 'vehicle-uploads'
    const storageQuery = supabase.storage.getBucket('vehicle-uploads');
    const { error } = await Promise.race([storageQuery, timeoutPromise(HEALTH_CHECK_TIMEOUT_MS)]) as { data: any, error: any };
    newStatus.storage = error ? 'unavailable' : 'healthy';
    if (error) console.warn('Storage health check failed:', error);
  } catch (err) {
    console.error('Storage health check exception:', err);
    newStatus.storage = 'unavailable';
  }
  
  // --- REMOVED Studio Check --- 
  // The check for Supabase Studio (port 54323) was removed 
  // as it was causing CORS errors and isn't essential for app health.

  // Update cache
  cachedStatus = newStatus;
  console.log('Supabase Health Status Updated:', cachedStatus);
  return newStatus;
}; 