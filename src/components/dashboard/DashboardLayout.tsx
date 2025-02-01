import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryForm } from "@/components/inventory/InventoryForm";
import { VehicleManagement } from "@/components/vehicles/VehicleManagement";
import { ServiceManagement } from "@/components/service/ServiceManagement";
import { GarageManagement } from "@/components/garage/GarageManagement";
import { supabase } from "@/integrations/supabase/client";
import { ReactNode } from "react";

interface DashboardLayoutProps {
  children?: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  return (
    <div className="min-h-screen bg-white font-system">
      <header className="border-b border-gov-blue bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-8">
            <div className="flex items-center gap-4">
              <span className="text-tiny text-gov-blue font-mono">TAMS/v1.0</span>
              <span className="text-tiny text-gray-600 font-mono">SID:{new Date().getTime()}</span>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              className="px-2 py-0.5 bg-gray-100 text-tiny hover:bg-gray-200 transition-colors border border-gray-400 font-mono"
            >
              EXIT_SYS
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="mb-2 text-tiny font-mono">
          <span className="text-[#666]">[SYS_MSG]</span>
          <span className="text-gray-600 ml-2">DATA_COLLECTION_NOTICE_ACTIVE</span>
        </div>

        <Tabs defaultValue="inventory" className="w-full">
          <TabsList className="w-full border-b border-gov-blue mb-2 bg-transparent h-7">
            <TabsTrigger 
              value="inventory" 
              className="text-tiny h-7 data-[state=active]:border-b data-[state=active]:border-gov-blue font-mono"
            >
              TAMS-1:INV
            </TabsTrigger>
            <TabsTrigger 
              value="vehicles" 
              className="text-tiny h-7 data-[state=active]:border-b data-[state=active]:border-gov-blue font-mono"
            >
              TAMS-2:VEH
            </TabsTrigger>
            <TabsTrigger 
              value="service" 
              className="text-tiny h-7 data-[state=active]:border-b data-[state=active]:border-gov-blue font-mono"
            >
              TAMS-3:SVC
            </TabsTrigger>
            <TabsTrigger 
              value="garages" 
              className="text-tiny h-7 data-[state=active]:border-b data-[state=active]:border-gov-blue font-mono"
            >
              TAMS-4:GAR
            </TabsTrigger>
          </TabsList>

          <div className="text-tiny mb-2 text-[#666] font-mono">
            HELP:1-800-TAMS-HELP
          </div>

          <TabsContent value="inventory">
            <InventoryForm />
          </TabsContent>

          <TabsContent value="vehicles">
            <VehicleManagement />
          </TabsContent>

          <TabsContent value="service">
            <ServiceManagement />
          </TabsContent>

          <TabsContent value="garages">
            <GarageManagement />
          </TabsContent>
        </Tabs>
        {children}

        <footer className="mt-4 text-tiny text-[#666] border-t border-gray-300 pt-2 font-mono">
          <div className="flex justify-between">
            <span>PRIV_ACT_1974:ACTIVE</span>
            <span>EST_BURDEN:0.5HR</span>
          </div>
        </footer>
      </main>
    </div>
  );
};