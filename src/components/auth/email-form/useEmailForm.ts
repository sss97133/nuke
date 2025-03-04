
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

export const useEmailForm = (
  showForgotPassword: boolean, 
  isSignUp: boolean,
  onError?: (error: string) => void
) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const { handleEmailLogin, handleForgotPassword } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
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
      
      let errorMessage = "An unexpected error occurred. Please try again.";
      
      if (error.message && typeof error.message === 'string') {
        if (error.message.includes("Email not confirmed")) {
          errorMessage = "Please check your email to confirm your account.";
        } else if (error.message.includes("Invalid login credentials")) {
          errorMessage = "Invalid email or password.";
        } else if (error.message.includes("User already registered")) {
          errorMessage = "This email is already registered. Please try logging in instead.";
        } else if (error.message.includes("Password should be")) {
          errorMessage = error.message; // Use Supabase's password requirement message
        } else if (error.message.includes("Email not confirmed")) {
          errorMessage = "Please check your email to confirm your account before logging in.";
        } else {
          errorMessage = error.message; // Use the original error message
        }
      }
      
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: errorMessage
      });
      
      // Pass the error to the parent component if callback provided
      if (onError) {
        onError(errorMessage);
      }
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
    handleSubmit
  };
};
