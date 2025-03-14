
import type { Database } from '../types';
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const usePhoneAuth = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const handlePhoneLogin = async (formattedPhone: string) => {
    try {
      setIsLoading(true);
      
      const { error } = await supabase.auth.signInWithOtp({
  if (error) console.error("Database query error:", error);
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
  if (error) console.error("Database query error:", error);
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
  if (error) console.error("Database query error:", error);
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
    handlePhoneLogin,
    verifyOtp
  };
};
