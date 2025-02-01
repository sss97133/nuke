import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { MarketDataCollector } from "@/components/market/MarketDataCollector";

const Index = () => {
  const { toast } = useToast();
  const [session, setSession] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

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

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF5]">
        <div className="text-center space-y-4 w-full max-w-md p-6 border border-gray-200 shadow-sm bg-white">
          <h1 className="text-2xl font-mono text-[#283845] tracking-tight">
            Technical Asset Management System
          </h1>
          <p className="text-[#666] text-sm font-mono">Authentication Required</p>
          <div className="space-y-4">
            <Input
              type="tel"
              placeholder="Phone Number (Format: +1234567890)"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="font-mono text-sm"
              disabled={isLoading}
            />
            {!showOtpInput ? (
              <Button
                onClick={handleSendOtp}
                className="w-full bg-[#283845] text-white font-mono text-sm hover:bg-[#1a2830] transition-colors"
                disabled={isLoading || !phoneNumber.trim()}
              >
                {isLoading ? "Processing..." : "Request Authentication Code"}
              </Button>
            ) : (
              <div className="space-y-4">
                <InputOTP
                  maxLength={6}
                  value={otp}
                  onChange={setOtp}
                  disabled={isLoading}
                  render={({ slots }) => (
                    <InputOTPGroup className="gap-2 justify-center">
                      {slots.map((slot, idx) => (
                        <InputOTPSlot key={idx} index={idx} className="font-mono" />
                      ))}
                    </InputOTPGroup>
                  )}
                />
                <Button
                  onClick={handleVerifyOtp}
                  className="w-full bg-[#283845] text-white font-mono text-sm hover:bg-[#1a2830] transition-colors"
                  disabled={isLoading || otp.length !== 6}
                >
                  {isLoading ? "Verifying..." : "Verify Authentication Code"}
                </Button>
              </div>
            )}
            <p className="text-xs text-gray-500 font-mono">
              System requires valid phone number with country code
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <MarketDataCollector />
    </DashboardLayout>
  );
};

export default Index;
