import React, { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import { Session, User, AuthError, SignInWithPasswordCredentials, SignUpWithPasswordCredentials } from '@supabase/supabase-js';
// Using relative path as a temporary fix for potential alias resolution issues
import { supabase } from '../integrations/supabase/client';

// Helper to format auth errors (basic implementation)
const formatError = (error: any): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
      return String(error.message);
  }
  return "An unknown authentication error occurred.";
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  handleEmailLogin: (email: string, password?: string, isSignUp?: boolean, avatarUrl?: string) => Promise<void>;
  handleForgotPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const defaultAuthContextValue: AuthContextType = {
  session: null,
  user: null,
  loading: true,
  handleEmailLogin: async () => { console.warn("AuthProvider not ready"); },
  handleForgotPassword: async () => { console.warn("AuthProvider not ready"); },
  signOut: async () => { console.warn("AuthProvider not ready"); }
};

const AuthContext = createContext<AuthContextType>(defaultAuthContextValue);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true; // Prevent state updates on unmounted component
    setLoading(true); // Ensure loading is true at start of effect

    // --- Initial Session Check --- 
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (isMounted) {
        console.log('AuthProvider: Initial getSession result:', initialSession?.user?.email);
        // Only set initial state if the listener hasn't already run
        // (Avoids race condition where listener fires before getSession resolves)
        if (loading) { 
          setSession(initialSession);
          setUser(initialSession?.user ?? null);
          setLoading(false); // Mark initial check as complete
        }
      }
    }).catch(error => {
      if (isMounted) {
        console.error("AuthProvider: Error getting initial session:", error);
        setLoading(false); // Still mark loading as complete on error
      }
    });

    // --- Auth State Change Listener --- 
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (isMounted) {
        console.log('AuthProvider: onAuthStateChange received:', _event, currentSession?.user?.email);
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setLoading(false); // Mark loading as complete on first event too
      }
    });

    // --- Cleanup --- 
    return () => { 
      isMounted = false;
      subscription?.unsubscribe(); 
    };
  }, []); // Run only once on mount

  const handleEmailLogin = useCallback(async (email: string, password?: string, isSignUp?: boolean, avatarUrl?: string): Promise<void> => {
    // Ensure password is provided for login/signup
    if (!password && !isSignUp) { // Allow signup without password if using OTP/Magic Link later
        throw new Error("Password is required for login or password-based signup.");
    }

    try {
      let response;
      if (isSignUp) {
        console.log('AuthProvider: Attempting signUp...');
        const options: SignUpWithPasswordCredentials = {
            email: email,
            password: password!, // We checked above it exists for signup
            options: {
                data: { // Optional: Add metadata like avatar_url during signup
                    avatar_url: avatarUrl || null
                }
            }
        };
        response = await supabase.auth.signUp(options);
      } else {
        console.log('AuthProvider: Attempting signInWithPassword...');
        const options: SignInWithPasswordCredentials = {
            email: email,
            password: password!, // Checked above
        };
        response = await supabase.auth.signInWithPassword(options);
      }

      console.log('AuthProvider: Auth response:', response);

      if (response.error) {
        // Throw the formatted error to be caught by the caller (useEmailForm)
        throw new Error(formatError(response.error));
      }

      // Session/User state will be updated by onAuthStateChange listener
      // No need to manually set state here

    } catch (error) {
      console.error("Auth Error in handleEmailLogin:", error);
      // Re-throw the original or formatted error
      throw new Error(formatError(error));
    }
  }, []);

  const handleForgotPassword = useCallback(async (email: string): Promise<void> => {
    try {
      console.log('AuthProvider: Sending password reset for:', email);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {});
      if (error) {
        throw new Error(formatError(error));
      }
    } catch (error) {
      console.error("Auth Error in handleForgotPassword:", error);
      throw new Error(formatError(error));
    }
  }, []);
  
  const signOut = useCallback(async (): Promise<void> => {
    try {
      console.log('AuthProvider: Signing out...');
      const { error } = await supabase.auth.signOut();
       if (error) {
        throw new Error(formatError(error));
      }
      // State updates handled by onAuthStateChange
    } catch (error) {
       console.error("Auth Error in signOut:", error);
       throw new Error(formatError(error));
    }
  }, []);

  const value: AuthContextType = {
    session,
    user,
    loading,
    handleEmailLogin,
    handleForgotPassword,
    signOut
  };

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