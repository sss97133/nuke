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
    <div className="min-h-screen bg-paper font-system">
      <header className="border-b-2 border-gov-blue bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-12">
            <div className="flex items-center space-x-4">
              <h1 className="text-doc text-gov-blue">
                TAMS/v1.0 [Technical Asset Management System]
              </h1>
              <span className="text-tiny text-gray-600">
                OMB Control No. 1234-5678
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-tiny">Session ID: {new Date().getTime()}</span>
              <button
                onClick={() => supabase.auth.signOut()}
                className="px-2 py-1 bg-gray-100 text-tiny hover:bg-gray-200 transition-colors border border-gray-400"
              >
                TERMINATE SESSION
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="mb-4 text-tiny">
          <p>PAPERWORK REDUCTION ACT STATEMENT</p>
          <p className="text-gray-600">
            The information collected on this form is required for the proper management of technical assets.
          </p>
        </div>

        <Tabs defaultValue="inventory" className="w-full">
          <TabsList className="w-full border-b-2 border-gov-blue mb-4 bg-transparent">
            <TabsTrigger 
              value="inventory" 
              className="text-doc data-[state=active]:border-b-2 data-[state=active]:border-gov-blue"
            >
              Form TAMS-1: Inventory Management
            </TabsTrigger>
            <TabsTrigger 
              value="vehicles" 
              className="text-doc data-[state=active]:border-b-2 data-[state=active]:border-gov-blue"
            >
              Form TAMS-2: Vehicle Registry
            </TabsTrigger>
            <TabsTrigger 
              value="service" 
              className="text-doc data-[state=active]:border-b-2 data-[state=active]:border-gov-blue"
            >
              Form TAMS-3: Service Records
            </TabsTrigger>
          </TabsList>

          <div className="text-tiny mb-4 text-gray-600">
            For assistance with this form, contact the TAMS Help Desk at 1-800-TAMS-HELP
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
        </Tabs>
        {children}

        <footer className="mt-8 text-tiny text-gray-600 border-t border-gray-300 pt-4">
          <p>Privacy Act Notice: The information provided on this form is protected under the Privacy Act of 1974.</p>
          <p>Burden Hours: Public reporting burden for this collection of information is estimated to average 0.5 hours per response.</p>
        </footer>
      </main>
    </div>
  );
};