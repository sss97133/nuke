
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Provider } from "@supabase/supabase-js";

export const useAuth = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Handle initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        console.log("[useAuth] Initial session found:", session);
        navigate('/dashboard');
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[useAuth] Auth state changed:", event, session ? "Session exists" : "No session");
      
      if (event === 'SIGNED_IN' && session) {
        navigate('/dashboard');
      } else if (event === 'SIGNED_OUT') {
        navigate('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  const handleSocialLogin = async (provider: Provider) => {
    try {
      setIsLoading(true);
      console.log("[useAuth] Starting OAuth flow with provider:", provider);
      console.log("[useAuth] Current URL:", window.location.href);
      console.log("[useAuth] Redirect URL:", `${window.location.origin}/auth/callback`);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: 'read:user user:email',
        }
      });

      if (error) {
        console.error("[useAuth] OAuth error details:", {
          message: error.message,
          status: error.status,
          name: error.name,
          stack: error.stack
        });
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: `${error.message} (Status: ${error.status})`,
        });
      } else {
        console.log("[useAuth] OAuth response data:", data);
        console.log("[useAuth] Provider URL:", data?.url);
        // Redirect to the provider's authorization URL
        if (data?.url) {
          window.location.href = data.url;
        }
      }
    } catch (error) {
      console.error("[useAuth] Unexpected error:", error);
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
      console.log("[useAuth] Starting logout process");
      
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      console.log("[useAuth] Successfully logged out");
      toast({
        title: "Logged out",
        description: "Successfully logged out",
      });
      
      localStorage.clear();
      sessionStorage.clear();
      
      navigate('/login');
      
    } catch (error) {
      console.error("[useAuth] Logout error:", error);
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
