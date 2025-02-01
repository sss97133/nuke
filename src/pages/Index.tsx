import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryForm } from "@/components/inventory/InventoryForm";
import { VehicleList } from "@/components/inventory/VehicleList";
import { ServiceTicketList } from "@/components/inventory/ServiceTicketList";
import { supabase } from "@/lib/supabaseClient";

const Index = () => {
  const { toast } = useToast();
  const [session, setSession] = useState(null);

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

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F1DE]">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-mono text-[#283845]">
            Automotive Inventory System
          </h1>
          <p className="text-[#9B2915]">Please sign in to continue</p>
          <button
            onClick={() => supabase.auth.signInWithOAuth({ provider: "google" })}
            className="px-6 py-2 bg-[#283845] text-white font-mono hover:bg-[#1a2830] transition-colors"
          >
            Sign In
          </button>
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