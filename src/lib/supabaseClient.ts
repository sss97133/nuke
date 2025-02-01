import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDc0ODc3NzgsImV4cCI6MjAyMzA2Mzc3OH0.Gy5YtPJqZGmVlBxgZQBTHXPQBGZlQFXxVGJqJXEOPJc';

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);