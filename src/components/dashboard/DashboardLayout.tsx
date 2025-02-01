import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryForm } from "@/components/inventory/InventoryForm";
import { VehicleManagement } from "@/components/vehicles/VehicleManagement";
import { ServiceManagement } from "@/components/service/ServiceManagement";
import { GarageManagement } from "@/components/garage/GarageManagement";
import { CommandBar } from "./CommandBar";
import { ReactNode } from "react";
import { 
  Car, 
  Warehouse, 
  Wrench, 
  Building2, 
  Terminal,
  HelpCircle,
  UserRound
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ProfessionalDashboard } from './ProfessionalDashboard';
import { supabase } from "@/integrations/supabase/client";

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
    <div className="min-h-screen bg-background font-system animate-fade-in">
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center space-x-4">
              <span className="text-sm text-primary font-mono">TAMS/v1.0</span>
              <span className="text-sm text-muted-foreground font-mono">SID:{new Date().getTime()}</span>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              className="px-3 py-1 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm transition-colors rounded-md font-mono"
            >
              EXIT_SYS
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-4 text-sm font-mono">
          <span className="text-muted-foreground">[SYS_MSG]</span>
          <span className="text-foreground/80 ml-2">DATA_COLLECTION_NOTICE_ACTIVE</span>
        </div>

        <Tabs defaultValue="inventory" className="w-full animate-scale-in">
          <TabsList className="w-full h-12 bg-secondary/20 rounded-lg p-1">
            <div className="flex justify-between w-full">
              <div className="flex">
                <TabsTrigger 
                  value="inventory" 
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md px-3 py-2 text-sm font-mono flex items-center gap-2"
                >
                  <Warehouse className="w-4 h-4" />
                  TAMS-1:INV
                </TabsTrigger>
                <TabsTrigger 
                  value="vehicles" 
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md px-3 py-2 text-sm font-mono flex items-center gap-2"
                >
                  <Car className="w-4 h-4" />
                  TAMS-2:VEH
                </TabsTrigger>
                <TabsTrigger 
                  value="service" 
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md px-3 py-2 text-sm font-mono flex items-center gap-2"
                >
                  <Wrench className="w-4 h-4" />
                  TAMS-3:SVC
                </TabsTrigger>
                <TabsTrigger 
                  value="garages" 
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md px-3 py-2 text-sm font-mono flex items-center gap-2"
                >
                  <Building2 className="w-4 h-4" />
                  TAMS-4:GAR
                </TabsTrigger>
                <TabsTrigger 
                  value="professional" 
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md px-3 py-2 text-sm font-mono flex items-center gap-2"
                >
                  <UserRound className="w-4 h-4" />
                  TAMS-5:PRO
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

          <CommandBar />

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
          </div>
        </Tabs>
        {children}

        <footer className="mt-8 text-sm text-muted-foreground border-t border-border/40 pt-4 font-mono">
          <div className="flex justify-between">
            <span>PRIV_ACT_1974:ACTIVE</span>
            <span>EST_BURDEN:0.5HR</span>
          </div>
        </footer>
      </main>
    </div>
  );
};