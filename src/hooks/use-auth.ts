
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Provider } from "@supabase/supabase-js";

export const useAuth = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const handleSocialLogin = async (provider: Provider) => {
    try {
      setIsLoading(true);
      console.log("Starting OAuth flow with provider:", provider);
      
      // Get the current URL without any query parameters
      const baseUrl = window.location.origin;
      const redirectTo = `${baseUrl}/auth/callback`;
      
      console.log("Base URL:", baseUrl);
      console.log("Redirect URL:", redirectTo);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
          scopes: provider === 'github' ? 'read:user user:email' : undefined
        }
      });

      if (error) {
        console.error("OAuth error details:", {
          message: error.message,
          status: error.status,
          name: error.name,
          stack: error.stack
        });
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: error.message,
        });
      } else {
        console.log("OAuth success response:", data);
        // Let the callback handle navigation
      }
    } catch (error) {
      console.error("Auth error full details:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to sign in. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoading(true);
      
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      toast({
        title: "Logged out",
        description: "Successfully logged out",
      });
      
      localStorage.clear();
      sessionStorage.clear();
      
      navigate('/login');
      
    } catch (error) {
      console.error("Logout error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to log out. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhoneLogin = async (formattedPhone: string) => {
    try {
      setIsLoading(true);
      
      const { error } = await supabase.auth.signInWithOtp({
        phone: formattedPhone,
      });

      if (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message,
        });
        return false;
      } else {
        toast({
          title: "Code Sent",
          description: "Please check your phone for the verification code",
        });
        return true;
      }
    } catch (error) {
      console.error("Phone auth error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send verification code. Please try again.",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyOtp = async (formattedPhone: string, otp: string) => {
    try {
      setIsLoading(true);
      
      const { data, error } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: otp,
        type: "sms",
      });

      if (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message,
        });
        return false;
      } else {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', data.user?.id)
          .single();

        toast({
          title: "Welcome",
          description: "Successfully logged in",
        });

        if (!profile?.username) {
          navigate('/onboarding');
        } else {
          navigate('/dashboard');
        }
        return true;
      }
    } catch (error) {
      console.error("OTP verification error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to verify code. Please try again.",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    handleSocialLogin,
    handleLogout,
    handlePhoneLogin,
    verifyOtp
  };
};
