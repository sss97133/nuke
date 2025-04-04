import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AuthError } from '@supabase/supabase-js';

export const usePhoneAuth = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

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
      const authError = error as AuthError;
      console.error("Phone auth error:", authError);
      toast({
        variant: "destructive",
        title: "Error",
        description: authError.message || "Failed to send verification code. Please try again.",
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
        // Safely access user data
        const userId = data.user?.id;
        
        if (userId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', userId)
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
        } else {
          // Handle missing user ID
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to retrieve user information",
          });
        }
        return true;
      }
    } catch (error) {
      const authError = error as AuthError;
      console.error("OTP verification error:", authError);
      toast({
        variant: "destructive",
        title: "Error",
        description: authError.message || "Failed to verify code. Please try again.",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    handlePhoneLogin,
    verifyOtp
  };
};
