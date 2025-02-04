import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal, HelpCircle, Car, Warehouse, Wrench, Building2, UserRound, Video } from "lucide-react";
import { InventoryForm } from "@/components/inventory/InventoryForm";
import { VehicleManagement } from "@/components/vehicles/VehicleManagement";
import { ServiceManagement } from "@/components/service/ServiceManagement";
import { GarageManagement } from "@/components/garage/GarageManagement";
import { ProfessionalDashboard } from "@/components/dashboard/ProfessionalDashboard";
import { AuctionList } from "@/components/auctions/AuctionList";
import { CreateAuction } from "@/components/auctions/CreateAuction";
import { StudioConfiguration } from "@/components/studio/StudioConfiguration";

interface DashboardTabsProps {
  showHelp: (section: string) => void;
}

export const DashboardTabs = ({ showHelp }: DashboardTabsProps) => {
  return (
    <>
      <TabsList className="w-full h-12 bg-background border border-border shadow-classic rounded-none p-1">
        <div className="flex justify-between w-full">
          <div className="flex gap-1">
            <TabsTrigger 
              value="inventory" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Warehouse className="w-4 h-4" />
              Inventory
            </TabsTrigger>
            <TabsTrigger 
              value="vehicles" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Car className="w-4 h-4" />
              Vehicles
            </TabsTrigger>
            <TabsTrigger 
              value="service" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Wrench className="w-4 h-4" />
              Service
            </TabsTrigger>
            <TabsTrigger 
              value="garages" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Building2 className="w-4 h-4" />
              Garages
            </TabsTrigger>
            <TabsTrigger 
              value="professional" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <UserRound className="w-4 h-4" />
              Professional
            </TabsTrigger>
            <TabsTrigger 
              value="auctions" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Building2 className="w-4 h-4" />
              Auctions
            </TabsTrigger>
            <TabsTrigger 
              value="studio" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Video className="w-4 h-4" />
              Studio
            </TabsTrigger>
          </div>
          <div className="flex items-center mr-2">
            <button
              onClick={() => showHelp(document.querySelector('[data-state="active"]')?.getAttribute('value') || 'inventory')}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors px-2 py-1"
            >
              <HelpCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Help</span>
            </button>
          </div>
        </div>
      </TabsList>

      <div className="mt-6 space-y-6">
        <TabsContent value="inventory" className="animate-fade-in">
          <InventoryForm />
        </TabsContent>

        <TabsContent value="vehicles" className="animate-fade-in">
          <VehicleManagement />
        </TabsContent>

        <TabsContent value="service" className="animate-fade-in">
          <ServiceManagement />
        </TabsContent>

        <TabsContent value="garages" className="animate-fade-in">
          <GarageManagement />
        </TabsContent>

        <TabsContent value="professional" className="animate-fade-in">
          <ProfessionalDashboard />
        </TabsContent>

        <TabsContent value="auctions" className="animate-fade-in">
          <div className="space-y-6">
            <AuctionList />
            <CreateAuction />
          </div>
        </TabsContent>

        <TabsContent value="studio" className="animate-fade-in">
          <StudioConfiguration />
        </TabsContent>
      </div>
    </>
  );
};