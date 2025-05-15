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
      console.log(`Initiating ${provider} login`);
      
      // Get the current location to redirect back after auth
      const returnToPath = window.location.pathname !== '/auth' && window.location.pathname !== '/login' 
        ? window.location.pathname 
        : '/dashboard';
      
      // Create state object for tracking return destination
      const stateParam = JSON.stringify({ 
        returnTo: returnToPath,
        timestamp: Date.now()
      });
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            state: stateParam
          }
        }
      });
      
      if (error) {
        console.error(`${provider} login error:`, error);
        throw error;
      }
      
      if (!data.url) {
        console.error(`No redirect URL returned for ${provider} login`);
        throw new Error(`No redirect URL returned for ${provider} login`);
      }
      
      console.log(`${provider} login successful, redirecting to provider...`);
      
      // Add a small spinner overlay to indicate login in progress
      if (typeof document !== 'undefined') {
        const existingOverlay = document.getElementById('auth-loading-overlay');
        if (existingOverlay) document.body.removeChild(existingOverlay);
        
        const overlay = document.createElement('div');
        overlay.id = 'auth-loading-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.3)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999';
        
        const spinner = document.createElement('div');
        spinner.style.border = '4px solid rgba(255,255,255,0.3)';
        spinner.style.borderTop = '4px solid #ffffff';
        spinner.style.borderRadius = '50%';
        spinner.style.width = '40px';
        spinner.style.height = '40px';
        spinner.style.animation = 'auth-spin 1s linear infinite';
        
        const style = document.createElement('style');
        style.innerHTML = '@keyframes auth-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
        
        document.head.appendChild(style);
        overlay.appendChild(spinner);
        document.body.appendChild(overlay);
        
        // Remove after 10 seconds as a failsafe
        setTimeout(() => {
          if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
          }
        }, 10000);
      }
      
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
      console.log(`Initiating password reset for email: ${email}`);
      
      // Use reset-password route for better user experience
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });
      
      if (error) {
        console.error('Password reset error:', error);
        throw error;
      }
      
      console.log('Password reset email sent successfully');
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
