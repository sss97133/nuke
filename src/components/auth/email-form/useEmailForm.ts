import { useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { formatAuthError } from "@/utils/supabase-helpers";

// Track previous auth attempts to prevent duplicate submissions
let previousAuthAttempt = {
  email: '',
  isSignUp: false,
  timestamp: 0
};

export const useEmailForm = (
  showForgotPassword: boolean, 
  isSignUp: boolean,
  onError?: (error: string) => void
) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const { handleEmailLogin, handleForgotPassword } = useAuth();
  const { toast } = useToast();

  // Check network status
  const checkNetworkStatus = useCallback(async (): Promise<boolean> => {
    try {
      setNetworkStatus('checking');
      // Simple network check by fetching a tiny resource
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      await fetch('https://www.google.com/favicon.ico', { 
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      setNetworkStatus('online');
      return true;
    } catch (error) {
      console.warn('Network check failed:', error);
      setNetworkStatus('offline');
      return false;
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Clear previous errors and set submitting state
    setFormError(null);
    setIsSubmitting(true);
    
    // Debug log in all environments to help troubleshoot
    console.log('[useEmailForm] Form submitted:', { 
      email, 
      passwordEntered: !!password, 
      isSignUp, 
      showForgotPassword 
    });
    
    // Prevent duplicate submissions
    const now = Date.now();
    if (
      email === previousAuthAttempt.email &&
      isSignUp === previousAuthAttempt.isSignUp &&
      now - previousAuthAttempt.timestamp < 2000 // 2 second cooldown
    ) {
      console.log('Preventing duplicate auth attempt');
      setIsSubmitting(false);
      return;
    }
    
    // Add a DOM element to show that form submission is happening
    // This is a failsafe in case React state isn't updating the UI
    if (typeof document !== 'undefined') {
      const existingDebug = document.getElementById('auth-debug-indicator');
      if (existingDebug) document.body.removeChild(existingDebug);
      
      const debugEl = document.createElement('div');
      debugEl.id = 'auth-debug-indicator';
      debugEl.style.position = 'fixed';
      debugEl.style.bottom = '10px';
      debugEl.style.right = '10px';
      debugEl.style.background = 'rgba(0,0,0,0.8)';
      debugEl.style.color = 'white';
      debugEl.style.padding = '10px';
      debugEl.style.borderRadius = '5px';
      debugEl.style.zIndex = '9999';
      debugEl.innerText = `Submitting auth form: ${email} | Mode: ${isSignUp ? 'signup' : 'login'}`;
      document.body.appendChild(debugEl);
      
      // Remove after 10 seconds
      setTimeout(() => {
        if (document.body.contains(debugEl)) {
          document.body.removeChild(debugEl);
        }
      }, 10000);
    }
    
    // Update the previous attempt tracker
    previousAuthAttempt = {
      email,
      isSignUp,
      timestamp: now
    };
    
    try {
      // Check network connectivity first
      const isOnline = await checkNetworkStatus();
      
      if (!isOnline) {
        toast({
          variant: "destructive",
          title: "Network Error",
          description: "You appear to be offline. Please check your internet connection and try again."
        });
        setFormError("Network connection unavailable");
        setIsSubmitting(false);
        if (onError) onError("Network connection unavailable");
        return;
      }
      
      // Only log auth attempts in development mode
      if (process.env.NODE_ENV === 'development') {
        console.log(`[useEmailForm] Attempting ${isSignUp ? 'signup' : 'login'} for email:`, email);
      }
      
      if (showForgotPassword) {
        console.log('[useEmailForm] Sending password reset email to:', email);
        try {
          await handleForgotPassword(email);
          console.log('[useEmailForm] Password reset email sent successfully');
          toast({
            title: "Reset Link Sent",
            description: "Please check your email for password reset instructions."
          });
        } catch (resetError) {
          console.error('[useEmailForm] Error sending reset email:', resetError);
          toast({
            variant: "destructive",
            title: "Reset Link Failed",
            description: "There was a problem sending the reset link. Please try again."
          });
        }
        setIsSubmitting(false);
        return;
      }

      // Simplified Login/Signup Flow
      try {
        console.log('[useEmailForm] Calling handleEmailLogin with:', { email, hasPassword: !!password, isSignUp, hasAvatar: !!avatarUrl });
        
        // Call the login/signup handler from useAuth
        await handleEmailLogin(email, password, isSignUp, avatarUrl);
        
        // IMPORTANT: No longer handle redirects here!
        // Rely on the AuthProvider's onAuthStateChange to update the state,
        // and the AppRouter to redirect based on the updated auth state.
        console.log('[useEmailForm] Login/signup call successful. Auth state update pending...');
        
        // Optionally show a generic success message, but avoid premature redirects
          toast({
          title: isSignUp ? "Signup Successful" : "Login Successful",
          description: "Processing authentication..."
        });

      } catch (loginError: unknown) {
        // Error handled by the outer catch block
        console.error('[useEmailForm] Error during login/signup call:', loginError);
        throw loginError as Error; // Re-throw to be caught below
      }
      
    } catch (error: unknown) {
      // Outer catch block handles errors from network check or handleEmailLogin
      console.error("[useEmailForm] Auth error:", error);
      const errorMessage = formatAuthError(error);
      setFormError(errorMessage);
      
      // Simplified toast logic
      toast({
        variant: "destructive",
        title: "Authentication Failed",
        description: errorMessage
      });
      
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      // Remove any temporary debug indicators if they exist
      if (typeof document !== 'undefined') {
        const debugIndicator = document.getElementById('auth-debug-indicator');
        if (debugIndicator) document.body.removeChild(debugIndicator);
        // Remove the green banner if it exists
        const navIndicators = document.querySelectorAll('div[style*="position: fixed"][style*="backgroundColor: green"]');
        navIndicators.forEach(ind => ind.remove());
        // Remove the blue banner if it exists
        const blueIndicators = document.querySelectorAll('div[style*="position: fixed"][style*="backgroundColor: #4444FF"]');
        blueIndicators.forEach(ind => ind.remove());
      }
      setIsSubmitting(false);
    }
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    rememberMe,
    setRememberMe,
    avatarUrl,
    setAvatarUrl,
    formError,
    setFormError,
    isSubmitting,
    networkStatus,
    handleSubmit
  };
};
