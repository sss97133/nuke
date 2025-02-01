import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryForm } from "@/components/inventory/InventoryForm";
import { VehicleManagement } from "@/components/vehicles/VehicleManagement";
import { ServiceManagement } from "@/components/service/ServiceManagement";
import { supabase } from "@/integrations/supabase/client";
import { ReactNode } from "react";

interface DashboardLayoutProps {
  children?: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  return (
    <div className="min-h-screen bg-[#FAFAF5]">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <h1 className="font-mono text-lg text-[#283845] tracking-tight">TAMS/v1.0</h1>
              <span className="text-xs text-gray-500 font-mono">Technical Asset Management System</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-xs text-gray-500 font-mono">Session Active</span>
              <button
                onClick={() => supabase.auth.signOut()}
                className="px-3 py-1 bg-[#F5F5F5] text-[#333] text-sm font-mono hover:bg-[#E5E5E5] transition-colors border border-gray-200"
              >
                Terminate Session
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="inventory" className="w-full">
          <TabsList className="w-full border-b border-gray-200 mb-6 bg-transparent">
            <TabsTrigger 
              value="inventory" 
              className="font-mono text-sm data-[state=active]:border-b-2 data-[state=active]:border-[#283845]"
            >
              Inventory Management
            </TabsTrigger>
            <TabsTrigger 
              value="vehicles" 
              className="font-mono text-sm data-[state=active]:border-b-2 data-[state=active]:border-[#283845]"
            >
              Vehicle Registry
            </TabsTrigger>
            <TabsTrigger 
              value="service" 
              className="font-mono text-sm data-[state=active]:border-b-2 data-[state=active]:border-[#283845]"
            >
              Service Records
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inventory">
            <InventoryForm />
          </TabsContent>

          <TabsContent value="vehicles">
            <VehicleManagement />
          </TabsContent>

          <TabsContent value="service">
            <ServiceManagement />
          </TabsContent>
        </Tabs>
        {children}
      </main>
    </div>
  );
};