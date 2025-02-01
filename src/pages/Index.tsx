import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { SystemStatus } from "@/components/dashboard/SystemStatus";
import { useQuery } from "@tanstack/react-query";

// Type guard for memory API
const getMemoryUsage = (): number => {
  // @ts-ignore - performance.memory exists in Chrome
  if (performance && performance.memory) {
    // @ts-ignore - accessing memory property
    return Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
  }
  return 0;
};

const Index = () => {
  const { toast } = useToast();
  const [session, setSession] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch summary data
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data } = await supabase.from('vehicles').select('*');
      return data;
    },
    enabled: !!session
  });

  const { data: inventory } = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data } = await supabase.from('inventory').select('*');
      return data;
    },
    enabled: !!session
  });

  const { data: serviceTickets } = useQuery({
    queryKey: ['service_tickets'],
    queryFn: async () => {
      const { data } = await supabase.from('service_tickets').select('*');
      return data;
    },
    enabled: !!session
  });

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
  }

  return (
    <div className="min-h-screen bg-white font-mono">
      <header className="border-b border-gov-blue bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-8">
            <div className="flex items-center gap-4">
              <span className="text-tiny text-gov-blue">TAMS/v1.0</span>
              <span className="text-tiny text-gray-600">SID:{new Date().getTime()}</span>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              className="px-2 py-0.5 bg-gray-100 text-tiny hover:bg-gray-200 transition-colors border border-gray-400"
            >
              EXIT_SYS
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="mb-2 text-tiny">
          <span className="text-[#666]">[SYS_MSG]</span>
          <span className="text-gray-600 ml-2">TERMINAL_READY</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {/* System Status */}
          <SystemStatus />

          {/* Vehicle Summary */}
          <div className="border border-gov-blue p-2">
            <div className="text-tiny text-[#666] border-b border-gov-blue pb-1 mb-1">
              VEH_SUMMARY
            </div>
            <div className="grid grid-cols-2 gap-1 text-tiny">
              <span>TOTAL:</span>
              <span>{vehicles?.length || 0}</span>
              <span>ACTIVE:</span>
              <span>{vehicles?.filter(v => !v.notes?.includes('INACTIVE')).length || 0}</span>
              <span>MAINT:</span>
              <span>{serviceTickets?.filter(t => t.status === 'pending').length || 0}</span>
            </div>
          </div>

          {/* Inventory Summary */}
          <div className="border border-gov-blue p-2">
            <div className="text-tiny text-[#666] border-b border-gov-blue pb-1 mb-1">
              INV_SUMMARY
            </div>
            <div className="grid grid-cols-2 gap-1 text-tiny">
              <span>TOTAL:</span>
              <span>{inventory?.length || 0}</span>
              <span>LOW_STOCK:</span>
              <span>{inventory?.filter(i => i.quantity < 5).length || 0}</span>
              <span>VAL($):</span>
              <span>{inventory?.reduce((acc, i) => acc + (i.purchase_price || 0), 0).toFixed(2)}</span>
            </div>
          </div>

          {/* Command Input */}
          <div className="border border-gov-blue p-2 col-span-full">
            <div className="flex gap-2 items-center">
              <span className="text-tiny text-[#666]">CMD:</span>
              <Input
                placeholder="ENTER_COMMAND"
                className="h-7 text-tiny bg-white font-mono"
              />
              <Button
                size="sm"
                className="h-7 bg-[#283845] hover:bg-[#1a2830] text-white text-tiny"
              >
                EXEC
              </Button>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="border border-gov-blue p-2 col-span-full">
            <div className="text-tiny text-[#666] border-b border-gov-blue pb-1 mb-1">
              RECENT_ACTIVITY
            </div>
            <div className="space-y-1">
              {serviceTickets?.slice(0, 5).map((ticket) => (
                <div key={ticket.id} className="text-tiny flex justify-between">
                  <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                  <span className="text-[#666]">{ticket.description.substring(0, 50)}</span>
                  <span>{ticket.status.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="text-tiny text-[#666] border-t border-gov-blue mt-4 pt-2">
          <div className="flex justify-between">
            <span>LAST_UPDATE: {new Date().toISOString()}</span>
            <span>MEM_USAGE: {getMemoryUsage()}MB</span>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
