// TEMPORARY AUTH OVERRIDE - Remove when Supabase auth is fixed
// This file monkey-patches the Supabase auth to work around the broken auth system

import { supabase } from './supabase';

const BYPASS_USER_ID = '11111111-1111-1111-1111-111111111111';

export function initAuthOverride() {
  // Check if we have a bypass session
  const bypassSession = localStorage.getItem('bypass-session');
  if (!bypassSession) {
    return; // No bypass active
  }

  try {
    const session = JSON.parse(bypassSession);
    
    // Check if session is still valid (not expired)
    if (session.expires_at < Date.now()) {
      localStorage.removeItem('bypass-session');
      return;
    }

    console.log('🔧 Auth override active - using bypass session');
    
    // Override auth methods
    const auth = supabase.auth as any;
    
    // Store original methods
    const originalMethods = {
      getSession: auth.getSession?.bind(auth),
      getUser: auth.getUser?.bind(auth),
      onAuthStateChange: auth.onAuthStateChange?.bind(auth),
      signOut: auth.signOut?.bind(auth)
    };

    // Override getSession
    auth.getSession = async () => ({
      data: { 
        session: {
          ...session,
          expires_in: Math.floor((session.expires_at - Date.now()) / 1000)
        }
      },
      error: null
    });

    // Override getUser  
    auth.getUser = async () => ({
      data: { user: session.user },
      error: null
    });

    // Override onAuthStateChange
    auth.onAuthStateChange = (callback: any) => {
      // Immediately call with current session
      if (callback) {
        setTimeout(() => {
          callback('SIGNED_IN', {
            ...session,
            expires_in: Math.floor((session.expires_at - Date.now()) / 1000)
          });
        }, 0);
      }
      
      // Return fake subscription
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              console.log('Auth subscription unsubscribed');
            }
          }
        }
      };
    };

    // Override signOut to clear bypass
    auth.signOut = async () => {
      localStorage.removeItem('bypass-session');
      // Reload page to reset everything
      window.location.href = '/login';
      return { error: null };
    };

    // Also ensure any profile operations use the bypass user ID
    const originalFrom = supabase.from.bind(supabase);
    (supabase as any).from = (table: string) => {
      const query = originalFrom(table);
      
      // For vehicle queries, override user_id filters
      if (table === 'vehicles') {
        const originalSelect = query.select.bind(query);
        (query as any).select = (...args: any[]) => {
          const result = originalSelect(...args);
          
          // Override eq when it's filtering by user_id  
          const originalEq = result.eq.bind(result);
          (result as any).eq = (column: string, value: any) => {
            if (column === 'user_id') {
              // Use bypass user ID instead
              return originalEq(column, BYPASS_USER_ID);
            }
            return originalEq(column, value);
          };
          
          return result;
        };
      }
      
      return query;
    };

    // Ensure profile exists for bypass user
    ensureBypassProfile();
    
  } catch (error) {
    console.error('Failed to initialize auth override:', error);
    localStorage.removeItem('bypass-session');
  }
}

async function ensureBypassProfile() {
  try {
    // Check if profile exists
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', BYPASS_USER_ID)
      .single();
      
    if (!existing) {
      // Create profile
      await supabase
        .from('profiles')
        .insert({
          id: BYPASS_USER_ID,
          email: 'skylar@gmail.com',
          username: 'skylar',
          full_name: 'Skylar Williams',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      console.log('✅ Bypass profile created');
    }
  } catch (error) {
    console.error('Could not ensure bypass profile:', error);
  }
}

// Auto-initialize on import
if (typeof window !== 'undefined') {
  initAuthOverride();
}
