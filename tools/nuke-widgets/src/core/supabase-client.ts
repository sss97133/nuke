import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Singleton map: one client per api-key
const clients = new Map<string, SupabaseClient>();

/**
 * Get or create a Supabase client for the given API key.
 * Multiple widgets on the same page with the same key share one client
 * (and one Realtime WebSocket connection).
 */
export function getSupabaseClient(apiKey: string | null): SupabaseClient {
  const key = apiKey || '__anon__';
  const existing = clients.get(key);
  if (existing) return existing;

  const client = createClient(SUPABASE_URL,
    // Anon key is the default auth for Supabase REST — safe to embed
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: apiKey ? { 'X-API-Key': apiKey } : {},
      },
    }
  );

  clients.set(key, client);
  return client;
}

/**
 * Call a Nuke edge function via the Supabase client.
 */
export async function callFunction<T = unknown>(
  apiKey: string | null,
  functionName: string,
  body?: Record<string, unknown>,
  method: 'GET' | 'POST' = 'POST'
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const url = `${FUNCTIONS_URL}/${functionName}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Widget API error: ${response.status}`);
  }

  return response.json();
}

/** Get the base functions URL */
export function getFunctionsUrl(): string {
  return FUNCTIONS_URL;
}

/** Get the Supabase project URL */
export function getSupabaseUrl(): string {
  return SUPABASE_URL;
}
