import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

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
    <div className="min-h-screen flex items-center justify-center bg-secondary dark:bg-secondary-dark font-system">
      <div className="w-full max-w-md p-8 space-y-6">
        <div className="classic-window">
          <div className="flex items-center justify-between border-b border-border dark:border-border-dark pb-4 mb-6">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-destructive rounded-full" />
              <div className="w-3 h-3 bg-accent rounded-full" />
              <div className="w-3 h-3 bg-muted rounded-full" />
            </div>
            <h1 className="text-center text-lg font-system">Welcome</h1>
            <div className="w-20" /> {/* Spacer for alignment */}
          </div>

          <div className="space-y-6">
            {!showOtpInput ? (
              <>
                <div className="space-y-2">
                  <label htmlFor="phone" className="block text-sm">
                    Enter your phone number to sign in
                  </label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+1 (555) 555-5555"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="classic-input w-full"
                    disabled={isLoading}
                  />
                </div>
                <Button
                  onClick={handleSendOtp}
                  className="classic-button w-full"
                  disabled={isLoading || !phoneNumber.trim()}
                >
                  {isLoading ? "Sending..." : "Continue"}
                </Button>
              </>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="block text-sm">
                    Enter the code sent to your phone
                  </label>
                  <InputOTP
                    maxLength={6}
                    value={otp}
                    onChange={setOtp}
                    disabled={isLoading}
                    render={({ slots }) => (
                      <InputOTPGroup className="gap-2 justify-center">
                        {slots.map((slot, idx) => (
                          <InputOTPSlot 
                            key={idx} 
                            {...slot}
                            index={idx}
                            className="classic-input w-10 h-10 text-center"
                          />
                        ))}
                      </InputOTPGroup>
                    )}
                  />
                </div>
                <Button
                  onClick={handleVerifyOtp}
                  className="classic-button w-full"
                  disabled={isLoading || otp.length !== 6}
                >
                  {isLoading ? "Verifying..." : "Sign In"}
                </Button>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-border dark:border-border-dark">
            <p className="text-xs text-muted-foreground dark:text-muted-foreground-dark text-center">
              This is a secure login system. Your phone number will be used for authentication only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};