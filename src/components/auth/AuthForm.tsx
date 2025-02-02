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
    <div className="min-h-screen flex items-center justify-center bg-secondary dark:bg-secondary-dark">
      <div className="w-full max-w-[400px] mx-4">
        <div className="classic-window">
          {/* Window Title Bar */}
          <div className="flex items-center justify-between border-b border-border dark:border-border-dark pb-2 mb-6">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-destructive rounded-full" />
              <div className="w-3 h-3 bg-accent rounded-full" />
              <div className="w-3 h-3 bg-muted rounded-full" />
            </div>
            <div className="text-center text-sm font-system">Welcome to Fleet Manager</div>
            <div className="w-12" /> {/* Spacer for alignment */}
          </div>

          <div className="space-y-6 px-4">
            {!showOtpInput ? (
              <>
                {/* Phone Input Section */}
                <div className="text-center mb-8">
                  <img 
                    src="/placeholder.svg" 
                    alt="Classic Mac Icon" 
                    className="w-20 h-20 mx-auto mb-4 opacity-80"
                  />
                  <h2 className="text-base font-system mb-1">Enter Phone Number</h2>
                  <p className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    Please enter your phone number to sign in
                  </p>
                </div>

                <div className="space-y-4">
                  <Input
                    type="tel"
                    placeholder="+1 (555) 555-5555"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="classic-input text-center"
                    disabled={isLoading}
                  />
                  <Button
                    onClick={handleSendOtp}
                    className="classic-button w-full"
                    disabled={isLoading || !phoneNumber.trim()}
                  >
                    {isLoading ? "Sending..." : "Continue"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* OTP Input Section */}
                <div className="text-center mb-8">
                  <img 
                    src="/placeholder.svg" 
                    alt="Classic Mac Icon" 
                    className="w-20 h-20 mx-auto mb-4 opacity-80"
                  />
                  <h2 className="text-base font-system mb-1">Enter Verification Code</h2>
                  <p className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    Enter the code sent to your phone
                  </p>
                </div>

                <div className="space-y-4">
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
                  <Button
                    onClick={handleVerifyOtp}
                    className="classic-button w-full"
                    disabled={isLoading || otp.length !== 6}
                  >
                    {isLoading ? "Verifying..." : "Sign In"}
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="mt-8 pt-4 border-t border-border dark:border-border-dark">
            <p className="text-[10px] text-center text-muted-foreground dark:text-muted-foreground-dark">
              Fleet Manager © 2024
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};