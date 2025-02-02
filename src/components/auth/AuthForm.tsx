import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ClassicWindow } from "./ClassicWindow";
import { PhoneInput } from "./PhoneInput";
import { OtpInput } from "./OtpInput";

export const AuthForm = () => {
  const { toast } = useToast();
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
      
      const { error } = await supabase.auth.verifyOtp({
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
        toast({
          title: "Welcome",
          description: "Successfully logged in",
        });
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
    <div className="min-h-screen flex items-center justify-center bg-secondary dark:bg-secondary-dark">
      <div className="w-full max-w-[400px] mx-4">
        <ClassicWindow title="Welcome">
          <div className="space-y-6 px-4">
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
          </div>

          <div className="mt-8 pt-4 border-t border-border dark:border-border-dark">
            <p className="text-[10px] text-center text-muted-foreground dark:text-muted-foreground-dark">
              Fleet Manager © 2024
            </p>
          </div>
        </ClassicWindow>
      </div>
    </div>
  );
};