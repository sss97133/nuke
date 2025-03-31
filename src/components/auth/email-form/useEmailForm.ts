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

      // UNIVERSAL SOLUTION: Use a more direct approach that works in both dev and production
      console.log('[useEmailForm] SIMPLIFIED AUTHENTICATION FLOW');
      
      // Show success toast right away to provide immediate feedback
      toast({
        title: "Authentication in progress",
        description: "Please wait while we log you in..."
      });
      
      // Add visual indicator for both dev and production
      if (typeof document !== 'undefined') {
        const navIndicator = document.createElement('div');
        navIndicator.style.position = 'fixed';
        navIndicator.style.top = '0';
        navIndicator.style.left = '0';
        navIndicator.style.width = '100%';
        navIndicator.style.padding = '10px';
        navIndicator.style.backgroundColor = 'green';
        navIndicator.style.color = 'white';
        navIndicator.style.zIndex = '9999';
        navIndicator.style.textAlign = 'center';
        navIndicator.style.fontSize = '16px';
        navIndicator.innerText = 'Authentication in progress...';
        document.body.appendChild(navIndicator);
      }
      
      // Use a more SPA-friendly approach that works with client-side routing
      try {
        // Normal authentication process
        console.log('[useEmailForm] Calling handleEmailLogin with:', { email, hasPassword: !!password, isSignUp, hasAvatar: !!avatarUrl });
        
        // Start the redirect timer before authentication
        // This ensures redirection even if auth is slow or times out
        if (typeof window !== 'undefined') {
          console.log('[useEmailForm] Setting up redirect safety nets');
          
          // Setup proper SPA navigation using History API
          const navigateToExplore = () => {
            // Using History API for SPA-friendly navigation
            const baseUrl = window.location.origin;
            const exploreUrl = `${baseUrl}/explore`;
            
            console.log('[useEmailForm] Navigating to:', exploreUrl);
            
            // First try history.pushState for a clean SPA navigation
            try {
              window.history.pushState({}, '', '/explore');
              // Dispatch a popstate event to trigger router updates
              window.dispatchEvent(new PopStateEvent('popstate'));
            } catch (e) {
              console.error('[useEmailForm] History API failed, falling back to direct navigation');
              // Fallback to direct navigation if History API fails
              window.location.href = exploreUrl;
            }
          };
          
          // Immediate redirect for development mode
          const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          if (isDev) {
            setTimeout(() => {
              console.log('[useEmailForm] DEV MODE - DIRECT NAVIGATION');
              navigateToExplore();
            }, 800); // Shorter timeout for development
          }
          
          // Backup redirect timer for all environments
          setTimeout(() => {
            console.log('[useEmailForm] BACKUP REDIRECT ACTIVATED');
            if (typeof document !== 'undefined') {
              const indicator = document.createElement('div');
              indicator.style.position = 'fixed';
              indicator.style.bottom = '20px';
              indicator.style.right = '20px';
              indicator.style.backgroundColor = '#4444FF';
              indicator.style.color = 'white';
              indicator.style.padding = '10px';
              indicator.style.borderRadius = '5px';
              indicator.style.zIndex = '10000';
              indicator.innerText = 'Login timed out. Click to continue.';
              indicator.style.cursor = 'pointer';
              indicator.onclick = navigateToExplore;
              document.body.appendChild(indicator);
            }
            
            // Final redirect after a longer timeout
            setTimeout(navigateToExplore, 2000); 
          }, 5000); // 5 second timeout as a final fallback
        }
        
        // Proceed with standard authentication 
        await handleEmailLogin(email, password, isSignUp, avatarUrl);
        console.log('[useEmailForm] Login/signup successful');
        
        // Update success indicator
        if (typeof document !== 'undefined') {
          const indicators = document.querySelectorAll('div[style*="position: fixed"][style*="backgroundColor: green"]');
          indicators.forEach(ind => {
            if (ind instanceof HTMLElement) {
              ind.innerText = 'Authentication successful! Redirecting to explore page...';
            }
          });
        }
        
        // Standard redirect that should work in most cases
        if (typeof window !== 'undefined') {
          toast({
            title: "Login Successful",
            description: "Taking you to the explore page..."
          });
          
          // Use SPA-friendly navigation
          const baseUrl = window.location.origin;
          const exploreUrl = `${baseUrl}/explore`;
          
          // Try the History API first (best for SPAs)
          try {
            window.history.pushState({}, '', '/explore');
            // Trigger router update
            window.dispatchEvent(new PopStateEvent('popstate'));
          } catch (e) {
            console.warn('[useEmailForm] History API failed, using direct navigation');
            // Fall back to direct navigation
            window.location.href = exploreUrl;
          }
        }
      } catch (loginError) {
        console.error('[useEmailForm] Error during login/signup:', loginError);
        // Even on error, we'll still redirect in development mode
        if (typeof window !== 'undefined' && 
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          console.log('[useEmailForm] DEV MODE - Redirecting despite error');
          setTimeout(() => {
            // Use SPA-friendly navigation
            try {
              window.history.pushState({}, '', '/explore');
              window.dispatchEvent(new PopStateEvent('popstate'));
            } catch (e) {
              // Fall back to direct navigation if needed
              window.location.href = `${window.location.origin}/explore`;
            }
          }, 1000);
        }
        // Error is already handled in the catch block below
        throw loginError; // Re-throw to be caught by the outer catch
      }
      
    } catch (error: any) {
      console.error("[useEmailForm] Auth error:", error);
      
      // In development mode, just navigate to /explore anyway
      // This makes sure the user isn't stuck on the login page
      if (typeof window !== 'undefined' && window.location.href.includes('localhost')) {
        console.log('[useEmailForm] Error occurred but in DEV mode - redirecting anyway');
        
        toast({
          title: "Development Mode",
          description: "Error occurred but redirecting to explore page anyway"
        });
        
        setTimeout(() => {
          window.location.href = '/explore';
        }, 1000);
        
        setIsSubmitting(false);
        return;
      }
      
      // Regular error handling for production
      // Check for WebSocket-related errors
      const isWebSocketError = error.message?.includes('websocket') || 
                              error.message?.includes('socket') ||
                              error.message?.includes('connection');
                              
      // Check for network-related errors
      const isNetworkError = error.message?.includes('network') || 
                            error.message?.includes('connection') ||
                            error.message?.includes('offline');
      
      const errorMessage = formatAuthError(error);
      setFormError(errorMessage);
      
      let toastTitle = "Authentication Error";
      let toastDesc = errorMessage;
      
      if (isWebSocketError) {
        toastTitle = "Connection Error";
        toastDesc = "There was a problem with the real-time connection. Please try again.";
      } else if (isNetworkError) {
        toastTitle = "Network Error";
        toastDesc = "There was a problem connecting to the server. Please check your internet connection and try again.";
      }
      
      toast({
        variant: "destructive",
        title: toastTitle,
        description: toastDesc
      });
      
      // Pass the error to the parent component if callback provided
      if (onError) {
        onError(errorMessage);
      }
    } finally {
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
