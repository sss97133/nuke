
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";

export const useEmailForm = (showForgotPassword: boolean, isSignUp: boolean) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const { handleEmailLogin, handleForgotPassword } = useAuth();

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

      const result = await handleEmailLogin(email, password, isSignUp, avatarUrl);
      console.log("[useEmailForm] Auth result:", result);
      
      if (result) {
        toast({
          title: isSignUp ? "Account Created" : "Welcome Back!",
          description: isSignUp ? "Your account has been created successfully." : "Successfully logged in"
        });
      }
    } catch (error: any) {
      console.error("[useEmailForm] Auth error:", error);
      
      let errorMessage = "An unexpected error occurred. Please try again.";
      
      if (error.message.includes("Email not confirmed")) {
        errorMessage = "Please check your email to confirm your account.";
      } else if (error.message.includes("Invalid login credentials")) {
        errorMessage = "Invalid email or password.";
      } else if (error.message.includes("User already registered")) {
        errorMessage = "This email is already registered. Please try logging in instead.";
      }
      
      toast({
        title: "Authentication Error",
        description: errorMessage,
        variant: "destructive"
      });
      
      throw error; // Re-throw to let the form component handle it
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
