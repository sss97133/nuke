import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal, Car, Warehouse, Wrench, Building2, UserRound, Video, Gavel, MicVocal } from "lucide-react";
import { InventoryForm } from "@/components/inventory/InventoryForm";
import { VehicleManagement } from "@/components/vehicles/VehicleManagement";
import { ServiceManagement } from "@/components/service/ServiceManagement";
import { GarageManagement } from "@/components/garage/GarageManagement";
import { ProfessionalDashboard } from "@/components/dashboard/ProfessionalDashboard";
import { AuctionList } from "@/components/auctions/AuctionList";
import { CreateAuction } from "@/components/auctions/CreateAuction";
import { StudioConfiguration } from "@/components/studio/StudioConfiguration";
import { Home } from "@/components/dashboard/Home";

interface DashboardTabsProps {
  showHelp: (section: string) => void;
}

export const DashboardTabs = ({ showHelp }: DashboardTabsProps) => {
  return (
    <>
      <TabsList className="w-full h-12 bg-background border border-border shadow-classic rounded-none p-1">
        <div className="flex justify-between w-full">
          <div className="grid grid-cols-8 w-full gap-1">
            <TabsTrigger 
              value="home" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center justify-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Terminal className="w-4 h-4" />
              <span className="hidden sm:inline">Home</span>
            </TabsTrigger>
            <TabsTrigger 
              value="inventory" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center justify-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Warehouse className="w-4 h-4" />
              <span className="hidden sm:inline">Inventory</span>
            </TabsTrigger>
            <TabsTrigger 
              value="vehicles" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center justify-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Car className="w-4 h-4" />
              <span className="hidden sm:inline">Vehicles</span>
            </TabsTrigger>
            <TabsTrigger 
              value="service" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center justify-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Wrench className="w-4 h-4" />
              <span className="hidden sm:inline">Service</span>
            </TabsTrigger>
            <TabsTrigger 
              value="garages" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center justify-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">Garages</span>
            </TabsTrigger>
            <TabsTrigger 
              value="professional" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center justify-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <UserRound className="w-4 h-4" />
              <span className="hidden sm:inline">Professional</span>
            </TabsTrigger>
            <TabsTrigger 
              value="auctions" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center justify-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Gavel className="w-4 h-4" />
              <span className="hidden sm:inline">Auctions</span>
            </TabsTrigger>
            <TabsTrigger 
              value="podcasting" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center justify-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <MicVocal className="w-4 h-4" />
              <span className="hidden sm:inline">Podcasting</span>
            </TabsTrigger>
          </div>
        </div>
      </TabsList>

      <div className="mt-6 space-y-6">
        <TabsContent value="home">
          <Home />
        </TabsContent>
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
        <TabsContent value="professional">
          <ProfessionalDashboard />
        </TabsContent>
        <TabsContent value="auctions">
          <div className="space-y-6">
            <AuctionList />
            <CreateAuction />
          </div>
        </TabsContent>
        <TabsContent value="studio">
          <StudioConfiguration />
        </TabsContent>
      </div>
    </>
  );
};
