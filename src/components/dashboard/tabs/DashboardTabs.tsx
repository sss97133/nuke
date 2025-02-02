import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal, HelpCircle, Car, Warehouse, Wrench, Building2, UserRound } from "lucide-react";
import { InventoryForm } from "@/components/inventory/InventoryForm";
import { VehicleManagement } from "@/components/vehicles/VehicleManagement";
import { ServiceManagement } from "@/components/service/ServiceManagement";
import { GarageManagement } from "@/components/garage/GarageManagement";
import { ProfessionalDashboard } from "@/components/dashboard/ProfessionalDashboard";
import { AuctionList } from "@/components/auctions/AuctionList";
import { CreateAuction } from "@/components/auctions/CreateAuction";
import { useToast } from "@/hooks/use-toast";

interface DashboardTabsProps {
  showHelp: (section: string) => void;
}

export const DashboardTabs = ({ showHelp }: DashboardTabsProps) => {
  return (
    <>
      <TabsList className="w-full h-12 bg-background border border-border shadow-classic rounded-none p-1">
        <div className="flex justify-between w-full">
          <div className="flex">
            <TabsTrigger 
              value="inventory" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Warehouse className="w-4 h-4" />
              TAMS-1:INV
            </TabsTrigger>
            <TabsTrigger 
              value="vehicles" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Car className="w-4 h-4" />
              TAMS-2:VEH
            </TabsTrigger>
            <TabsTrigger 
              value="service" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Wrench className="w-4 h-4" />
              TAMS-3:SVC
            </TabsTrigger>
            <TabsTrigger 
              value="garages" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Building2 className="w-4 h-4" />
              TAMS-4:GAR
            </TabsTrigger>
            <TabsTrigger 
              value="professional" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <UserRound className="w-4 h-4" />
              TAMS-5:PRO
            </TabsTrigger>
            <TabsTrigger 
              value="auctions" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-none px-3 py-2 text-sm font-mono flex items-center gap-2 shadow-classic data-[state=active]:shadow-classic-pressed"
            >
              <Building2 className="w-4 h-4" />
              TAMS-6:AUC
            </TabsTrigger>
          </div>
          <div className="flex items-center gap-4 px-2">
            <button
              onClick={() => showHelp('terminal')}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
            >
              <Terminal className="w-4 h-4" />
              <span className="hidden sm:inline">CMD Help</span>
            </button>
            <button
              onClick={() => showHelp(document.querySelector('[data-state="active"]')?.getAttribute('value') || 'inventory')}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Section Help</span>
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
            <CreateAuction />
            <AuctionList />
          </div>
        </TabsContent>
      </div>
    </>
  );
};