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
        let errorMessage = "Failed to send OTP";
        try {
          const errorBody = JSON.parse(error.message);
          if (errorBody.code === "sms_send_failed") {
            errorMessage = "SMS service is currently unavailable. Please try again later or contact support.";
            console.error("Detailed error:", errorBody);
          }
        } catch {
          errorMessage = error.message;
        }

        toast({
          variant: "destructive",
          title: "Error",
          description: errorMessage,
        });
        setShowOtpInput(false);
      } else {
        setShowOtpInput(true);
        toast({
          title: "Success",
          description: "OTP sent to your phone number",
        });
      }
    } catch (error) {
      console.error("Detailed error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
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
          title: "Success",
          description: "Successfully logged in",
        });
      }
    } catch (error) {
      console.error("Verification error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to verify OTP",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white font-system">
      <div className="text-center space-y-4 w-full max-w-md p-6 border-2 border-gov-blue bg-white">
        <div className="border-b-2 border-gov-blue pb-4">
          <h1 className="text-doc text-gov-blue">
            FORM SF-AUTH
          </h1>
          <p className="text-tiny text-gray-600">
            TECHNICAL ASSET MANAGEMENT SYSTEM (TAMS) ACCESS REQUEST
          </p>
        </div>

        <div className="space-y-4 text-left">
          <div>
            <p className="text-tiny mb-2">SECTION 1 - AUTHENTICATION REQUIREMENTS</p>
            <Input
              type="tel"
              placeholder="TELEPHONE NUMBER (Format: +1234567890)"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="font-system text-doc"
              disabled={isLoading}
            />
          </div>

          {!showOtpInput ? (
            <Button
              onClick={handleSendOtp}
              className="w-full bg-gov-blue text-white font-system text-doc hover:bg-blue-900 transition-colors"
              disabled={isLoading || !phoneNumber.trim()}
            >
              {isLoading ? "PROCESSING..." : "REQUEST AUTHENTICATION CODE"}
            </Button>
          ) : (
            <div className="space-y-4">
              <p className="text-tiny">SECTION 2 - VERIFICATION CODE ENTRY</p>
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={setOtp}
                disabled={isLoading}
                render={({ slots }) => (
                  <InputOTPGroup className="gap-2 justify-center">
                    {slots.map((slot, idx) => (
                      <InputOTPSlot key={idx} index={idx} className="font-system" />
                    ))}
                  </InputOTPGroup>
                )}
              />
              <Button
                onClick={handleVerifyOtp}
                className="w-full bg-gov-blue text-white font-system text-doc hover:bg-blue-900 transition-colors"
                disabled={isLoading || otp.length !== 6}
              >
                {isLoading ? "VERIFYING..." : "SUBMIT VERIFICATION CODE"}
              </Button>
            </div>
          )}
        </div>

        <div className="text-tiny text-left text-gray-600 border-t-2 border-gov-blue pt-4">
          <p>NOTICE:</p>
          <p>1. Valid telephone number with country code required.</p>
          <p>2. This is a U.S. Government system. Unauthorized access prohibited.</p>
          <p>3. All activities may be monitored and recorded.</p>
        </div>
      </div>
    </div>
  );
};