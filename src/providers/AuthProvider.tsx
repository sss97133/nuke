import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase-client';
import { useUserStore } from '../stores/userStore';

// Define the context type
interface AuthContextType {
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Create the context with default values
const AuthContext = createContext<AuthContextType>({
  session: null,
  isLoading: true,
  isAuthenticated: false
});

// Create a hook to use the auth context
const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Define props for the provider
interface AuthProviderProps {
  children: React.ReactNode;
}

// Create the AuthProvider component
const AuthProviderComponent: React.FC<AuthProviderProps> = ({ children }) => {
  // Get state and actions from the user store
  const { isLoading, isAuthenticated, getCurrentUser, setLoading, setAuthenticated } = useUserStore();
  
  // Local state for the session
  const [session, setSession] = useState<Session | null>(null);
  
  // Initialize auth state
  useEffect(() => {
    // Track component mount state to avoid updating state after unmount
    let isMounted = true;
    
    // Function to initialize the auth state
    const initializeAuth = async () => {
      try {
        // Get the current session
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        
        // Only update state if component is still mounted
        if (isMounted) {
          setSession(currentSession);
          setAuthenticated(!!currentSession);
          
          // If there's a session, fetch the user data
          if (currentSession) {
            await getCurrentUser();
          } else {
            setLoading(false);
          }
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    // Initialize auth state
    initializeAuth();
    
    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (isMounted) {
          console.log(`Auth state changed: ${event}`);
          setSession(newSession);
          setAuthenticated(!!newSession);
          
          // Handle different auth events
          switch (event) {
            case 'SIGNED_IN':
              await getCurrentUser();
              break;
            case 'SIGNED_OUT':
              setLoading(false);
              break;
            case 'TOKEN_REFRESHED':
              // Just update the session, no need to reload user
              setLoading(false);
              break;
            case 'USER_UPDATED':
              await getCurrentUser();
              break;
            default:
              setLoading(false);
          }
        }
      }
    );
    
    // Clean up on unmount
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [getCurrentUser, setAuthenticated, setLoading]);
  
  // Create the context value
  const value: AuthContextType = {
    session,
    isLoading,
    isAuthenticated
  };
  
  // Render the provider
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Export the component and hook separately
export { AuthProviderComponent as AuthProvider };
export { useAuth };

// Default export for convenience
export default AuthProviderComponent;
