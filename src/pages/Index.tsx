import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryForm } from "@/components/inventory/InventoryForm";
import { VehicleList } from "@/components/inventory/VehicleList";
import { ServiceTicketList } from "@/components/inventory/ServiceTicketList";
import { supabase } from "@/lib/supabaseClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const Index = () => {
  const { toast } = useToast();
  const [session, setSession] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);

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

  const handleSendOtp = async () => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: phoneNumber,
      });

      if (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message,
        });
      } else {
        setShowOtpInput(true);
        toast({
          title: "Success",
          description: "OTP sent to your phone number",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send OTP",
      });
    }
  };

  const handleVerifyOtp = async () => {
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: phoneNumber,
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
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to verify OTP",
      });
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F1DE]">
        <div className="text-center space-y-4 w-full max-w-md p-6">
          <h1 className="text-4xl font-mono text-[#283845]">
            Automotive Inventory System
          </h1>
          <p className="text-[#9B2915]">Please sign in to continue</p>
          <div className="space-y-4">
            <Input
              type="tel"
              placeholder="Enter phone number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full"
            />
            {!showOtpInput ? (
              <Button
                onClick={handleSendOtp}
                className="w-full bg-[#283845] text-white font-mono hover:bg-[#1a2830] transition-colors"
              >
                Send OTP
              </Button>
            ) : (
              <>
                <Input
                  type="text"
                  placeholder="Enter OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full"
                />
                <Button
                  onClick={handleVerifyOtp}
                  className="w-full bg-[#283845] text-white font-mono hover:bg-[#1a2830] transition-colors"
                >
                  Verify OTP
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF5] p-6 font-mono">
      <header className="mb-8 border-b-2 border-[#283845] pb-4">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl text-[#283845]">AUTOMOTIVE INVENTORY SYSTEM</h1>
          <button
            onClick={() => supabase.auth.signOut()}
            className="px-4 py-2 bg-[#9B2915] text-white hover:bg-[#7a1f10] transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      <Tabs defaultValue="inventory" className="w-full">
        <TabsList className="w-full border-b border-[#283845] mb-4">
          <TabsTrigger value="inventory" className="font-mono">
            Inventory
          </TabsTrigger>
          <TabsTrigger value="vehicles" className="font-mono">
            Vehicles
          </TabsTrigger>
          <TabsTrigger value="service" className="font-mono">
            Service Tickets
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inventory">
          <InventoryForm />
        </TabsContent>

        <TabsContent value="vehicles">
          <VehicleList />
        </TabsContent>

        <TabsContent value="service">
          <ServiceTicketList />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Index;