
import { useState } from "react";
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
  const { handleEmailLogin, handleForgotPassword } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    
    try {
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
      
      // Check for network-related errors that might be caused by WebSocket issues
      const isNetworkError = error.message?.includes('network') || 
                            error.message?.includes('connection') ||
                            error.message?.includes('offline');
      
      const errorMessage = formatAuthError(error);
      setFormError(errorMessage);
      
      toast({
        variant: "destructive",
        title: isNetworkError ? "Network Error" : "Authentication Error",
        description: isNetworkError 
          ? "There was a problem connecting to the server. Please check your internet connection and try again."
          : errorMessage
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
    handleSubmit
  };
};
