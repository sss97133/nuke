import React, { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// Define the shape of our auth context
interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

// Create the context with default values
const AuthContext = createContext<AuthContextType>({ 
  session: null, 
  user: null, 
  loading: true 
});

// Provider props interface
interface AuthProviderProps {
  children: ReactNode;
}

// Create the AuthProvider component
export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Track if the component is mounted to prevent state updates after unmount
    let isMounted = true;
    
    // Check initial session
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (isMounted) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        }
      }).catch(error => {
        console.error("Error getting initial session:", error);
        if (isMounted) {
          setLoading(false);
        }
      });
    } else {
      console.error("Supabase client not initialized");
      if (isMounted) {
        setLoading(false);
      }
    }

    // Listen for auth state changes
    let subscription;
    if (supabase) {
      const authStateChange = supabase.auth.onAuthStateChange((_event, session) => {
        if (isMounted) {
          console.log('Auth state change detected:', _event);
          setSession(session);
          setUser(session?.user ?? null);
          if (loading) setLoading(false);
        }
      });
      subscription = authStateChange.data.subscription;
    }

    // Cleanup subscription on unmount
    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []); // Run only once on mount

  // Create the context value
  const value = {
    session,
    user,
    loading,
  };

  // Render the provider
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
