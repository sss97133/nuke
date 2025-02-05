import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ClassicWindow } from "./ClassicWindow";
import { PhoneInput } from "./PhoneInput";
import { OtpInput } from "./OtpInput";

export const AuthForm = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const formatPhoneNumber = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    }
    if (phone.startsWith("+")) {
      return cleaned;
    }
    return `+${cleaned}`;
  };

  const handleSendOtp = async () => {
    try {
      setIsLoading(true);
      const formattedPhone = formatPhoneNumber(phoneNumber);
      
      const { error } = await supabase.auth.signInWithOtp({
        phone: formattedPhone,
      });

      if (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message,
        });
        setShowOtpInput(false);
      } else {
        setShowOtpInput(true);
        toast({
          title: "Code Sent",
          description: "Please check your phone for the verification code",
        });
      }
    } catch (error) {
      console.error("Error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send verification code. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    try {
      setIsLoading(true);
      const formattedPhone = formatPhoneNumber(phoneNumber);
      
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
      } else {
        // Check if this is a new user by querying their profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', data.user?.id)
          .single();

        toast({
          title: "Welcome",
          description: "Successfully logged in",
        });

        // If no username is set, redirect to onboarding
        if (!profile?.username) {
          navigate('/onboarding');
        } else {
          navigate('/dashboard');
        }
      }
    } catch (error) {
      console.error("Error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to verify code. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[400px]">
      <ClassicWindow title="Welcome">
        <div className="space-y-6">
          {!showOtpInput ? (
            <PhoneInput
              phoneNumber={phoneNumber}
              setPhoneNumber={setPhoneNumber}
              onSubmit={handleSendOtp}
              isLoading={isLoading}
            />
          ) : (
            <OtpInput
              otp={otp}
              setOtp={setOtp}
              onSubmit={handleVerifyOtp}
              isLoading={isLoading}
            />
          )}

          <div className="pt-4 border-t border-border dark:border-border-dark">
            <p className="text-[10px] text-center text-muted-foreground dark:text-muted-foreground-dark">
              NUKE © 2024
            </p>
          </div>
        </div>
      </ClassicWindow>
    </div>
  );
};