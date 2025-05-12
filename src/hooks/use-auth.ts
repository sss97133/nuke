/**
 * AUTHENTICATION SYSTEM CONSOLIDATION
 * 
 * This is a compatibility layer that provides the same API surface
 * as the old authentication system, but redirects to our new
 * consolidated implementation.
 */

import { useAuth as useNewAuth } from "@/providers/AuthProvider";
import { useUserStore } from "@/stores/userStore";
import { supabase } from "@/lib/supabase-client";
import { useState } from "react";

export const useAuth = () => {
  // Get authentication state from our new provider
  const { session, isLoading: authLoading, isAuthenticated } = useNewAuth();
  
  // Get user store methods
  const { user, getCurrentUser, signOut } = useUserStore();
  
  // Local loading states for compatibility
  const [isEmailLoading, setEmailLoading] = useState(false);
  const [isPhoneLoading, setPhoneLoading] = useState(false);
  const [isSocialLoading, setSocialLoading] = useState(false);
  
  // Email authentication
  const handleEmailLogin = async (email: string, password: string) => {
    try {
      setEmailLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      
      if (error) throw error;
      
      // Refresh user data
      await getCurrentUser();
      return true;
    } catch (error) {
      console.error('Error logging in with email:', error);
      return false;
    } finally {
      setEmailLoading(false);
    }
  };
  
  // Phone authentication
  const handlePhoneLogin = async (phone: string) => {
    try {
      setPhoneLoading(true);
      const { error } = await supabase.auth.signInWithOtp({
        phone
      });
      
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error sending OTP:', error);
      return false;
    } finally {
      setPhoneLoading(false);
    }
  };
  
  // OTP verification
  const verifyOtp = async (phone: string, token: string) => {
    try {
      setPhoneLoading(true);
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: 'sms'
      });
      
      if (error) throw error;
      
      // Refresh user data
      await getCurrentUser();
      return true;
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return false;
    } finally {
      setPhoneLoading(false);
    }
  };
  
  // Social login
  const handleSocialLogin = async (provider: 'google' | 'github' | 'facebook' | 'twitter' | 'apple') => {
    try {
      setSocialLoading(true);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      });
      
      if (error) throw error;
      if (!data.url) throw new Error('No redirect URL returned');
      
      // Redirect to provider's login page
      window.location.href = data.url;
      return true;
    } catch (error) {
      console.error('Error with social login:', error);
      return false;
    } finally {
      setSocialLoading(false);
    }
  };
  
  // Password reset
  const handleForgotPassword = async (email: string) => {
    try {
      setEmailLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?reset=true`
      });
      
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error with password reset:', error);
      return false;
    } finally {
      setEmailLoading(false);
    }
  };
  
  // Logout
  const handleLogout = async () => {
    try {
      await signOut();
      return true;
    } catch (error) {
      console.error('Error signing out:', error);
      return false;
    }
  };
  
  return {
    isLoading: authLoading || isEmailLoading || isPhoneLoading || isSocialLoading,
    user,
    session,
    handleSocialLogin,
    handleLogout,
    handlePhoneLogin,
    verifyOtp,
    handleEmailLogin,
    handleForgotPassword
  };
};
