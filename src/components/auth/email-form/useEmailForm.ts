
import { useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { formatAuthError } from "@/utils/supabase-helpers";

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
    setFormError(null);
    setIsSubmitting(true);
    
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
      
      console.log(`[useEmailForm] Attempting ${isSignUp ? 'signup' : 'login'} for email:`, email);
      
      if (showForgotPassword) {
        await handleForgotPassword(email);
        toast({
          title: "Reset Link Sent",
          description: "Please check your email for password reset instructions."
        });
        return;
      }

      await handleEmailLogin(email, password, isSignUp, avatarUrl);
      
    } catch (error: any) {
      console.error("[useEmailForm] Auth error:", error);
      
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
