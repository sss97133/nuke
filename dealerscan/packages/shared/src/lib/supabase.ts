import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseConfig {
  url: string
  anonKey: string
}

let _supabase: SupabaseClient | null = null
let _config: SupabaseConfig | null = null

export function initSupabase(config: SupabaseConfig): SupabaseClient {
  _config = config
  _supabase = createClient(config.url, config.anonKey)
  return _supabase
}

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    throw new Error('Supabase not initialized. Call initSupabase() first.')
  }
  return _supabase
}

export function getSupabaseUrl(): string {
  if (!_config) {
    throw new Error('Supabase not initialized. Call initSupabase() first.')
  }
  return _config.url
}
