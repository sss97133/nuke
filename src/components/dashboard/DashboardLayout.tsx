import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryForm } from "@/components/inventory/InventoryForm";
import { VehicleManagement } from "@/components/vehicles/VehicleManagement";
import { ServiceManagement } from "@/components/service/ServiceManagement";
import { GarageManagement } from "@/components/garage/GarageManagement";
import { CommandBar } from "./CommandBar";
import { supabase } from "@/integrations/supabase/client";
import { ReactNode } from "react";
import { 
  Car, 
  Warehouse, 
  Wrench, 
  Building2, 
  Terminal,
  HelpCircle,
  UserRound,
  Trees
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { ProfessionalDashboard } from './ProfessionalDashboard';

interface DashboardLayoutProps {
  children?: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const { toast } = useToast();

  const showHelp = (section: string) => {
    const helpText: { [key: string]: string } = {
      inventory: "Manage parts and equipment inventory:\n• Add new items\n• Track quantities\n• Set maintenance schedules\n• Monitor stock levels",
      vehicles: "Vehicle fleet management:\n• Register new vehicles\n• Track maintenance\n• View vehicle history\n• Process VIN numbers",
      service: "Service ticket system:\n• Create service requests\n• Track maintenance\n• Set priorities\n• Monitor status",
      garages: "Garage management:\n• Create garages\n• Manage members\n• Track locations\n• Assign vehicles",
      terminal: "Command terminal:\n• Type 'help' for commands\n• Quick system access\n• Search functionality\n• View system status",
      professional: "Professional Dashboard:\n• View skill tree\n• Track achievements\n• Manage profile\n• Monitor progress"
    };

    toast({
      title: `${section.toUpperCase()} Help`,
      description: helpText[section.toLowerCase()],
      duration: 5000,
    });
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF] font-system">
      <header className="border-b border-[#000066] bg-[#FFFFFF]">
        <div className="max-w-7xl mx-auto px-2">
          <div className="flex justify-between items-center h-6">
            <div className="flex items-center gap-2">
              <span className="text-tiny text-[#000066] font-mono">TAMS/v1.0</span>
              <span className="text-tiny text-[#666666] font-mono">SID:{new Date().getTime()}</span>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              className="px-2 py-0.5 bg-[#C8C8C9] text-tiny hover:bg-[#8A898C] transition-colors border border-[#403E43] font-mono"
            >
              EXIT_SYS
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-2 py-1">
        <div className="mb-1 text-tiny font-mono">
          <span className="text-[#666666]">[SYS_MSG]</span>
          <span className="text-[#403E43] ml-2">DATA_COLLECTION_NOTICE_ACTIVE</span>
        </div>

        <Tabs defaultValue="inventory" className="w-full">
          <TabsList className="w-full border-b border-[#000066] mb-1 bg-transparent h-6">
            <div className="flex justify-between w-full">
              <div className="flex">
                <TabsTrigger 
                  value="inventory" 
                  className="text-tiny h-6 data-[state=active]:border-b data-[state=active]:border-[#000066] font-mono flex items-center gap-1"
                >
                  <Warehouse className="w-3 h-3" />
                  TAMS-1:INV
                </TabsTrigger>
                <TabsTrigger 
                  value="vehicles" 
                  className="text-tiny h-6 data-[state=active]:border-b data-[state=active]:border-[#000066] font-mono flex items-center gap-1"
                >
                  <Car className="w-3 h-3" />
                  TAMS-2:VEH
                </TabsTrigger>
                <TabsTrigger 
                  value="service" 
                  className="text-tiny h-6 data-[state=active]:border-b data-[state=active]:border-[#000066] font-mono flex items-center gap-1"
                >
                  <Wrench className="w-3 h-3" />
                  TAMS-3:SVC
                </TabsTrigger>
                <TabsTrigger 
                  value="garages" 
                  className="text-tiny h-6 data-[state=active]:border-b data-[state=active]:border-[#000066] font-mono flex items-center gap-1"
                >
                  <Building2 className="w-3 h-3" />
                  TAMS-4:GAR
                </TabsTrigger>
                <TabsTrigger 
                  value="professional" 
                  className="text-tiny h-6 data-[state=active]:border-b data-[state=active]:border-[#000066] font-mono flex items-center gap-1"
                >
                  <UserRound className="w-3 h-3" />
                  TAMS-5:PRO
                </TabsTrigger>
              </div>
              <div className="flex items-center gap-2 pr-1">
                <button
                  onClick={() => showHelp('terminal')}
                  className="text-tiny text-[#666666] hover:text-[#403E43] flex items-center gap-1"
                >
                  <Terminal className="w-3 h-3" />
                  <span className="hidden sm:inline">CMD Help</span>
                </button>
                <button
                  onClick={() => showHelp(document.querySelector('[data-state="active"]')?.getAttribute('value') || 'inventory')}
                  className="text-tiny text-[#666666] hover:text-[#403E43] flex items-center gap-1"
                >
                  <HelpCircle className="w-3 h-3" />
                  <span className="hidden sm:inline">Section Help</span>
                </button>
              </div>
            </div>
          </TabsList>

          <CommandBar />

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
        </Tabs>
        {children}

        <footer className="mt-2 text-tiny text-[#666666] border-t border-[#403E43] pt-1 font-mono">
          <div className="flex justify-between">
            <span>PRIV_ACT_1974:ACTIVE</span>
            <span>EST_BURDEN:0.5HR</span>
          </div>
        </footer>
      </main>
    </div>
  );
};