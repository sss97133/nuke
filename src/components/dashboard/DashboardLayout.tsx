import { Tabs } from "@/components/ui/tabs";
import { CommandBar } from "./CommandBar";
import { ReactNode, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DashboardHeader } from "./header/DashboardHeader";
import { DashboardTabs } from "./tabs/DashboardTabs";
import { DashboardFooter } from "./footer/DashboardFooter";
import { FormDialogs } from "./dialogs/FormDialogs";

interface DashboardLayoutProps {
  children?: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const { toast } = useToast();
  const [showNewVehicleDialog, setShowNewVehicleDialog] = useState(false);
  const [showNewInventoryDialog, setShowNewInventoryDialog] = useState(false);

  const handleMenuAction = (action: string) => {
    switch (action) {
      case 'new_vehicle':
        setShowNewVehicleDialog(true);
        break;
      case 'new_inventory':
        setShowNewInventoryDialog(true);
        break;
      case 'exit':
        if (confirm('Are you sure you want to exit?')) {
          supabase.auth.signOut();
        }
        break;
      case 'about':
        toast({ 
          title: "About TAMS",
          description: "Technical Asset Management System v1.0\nDeveloped with ❤️ using modern web technologies."
        });
        break;
      case 'preferences':
        toast({ 
          title: "Preferences",
          description: "Preferences dialog will be implemented soon."
        });
        break;
      default:
        toast({ 
          title: `${action} selected`,
          description: "This feature will be implemented soon."
        });
    }
  };

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
      <DashboardHeader handleMenuAction={handleMenuAction} />

      <FormDialogs
        showNewVehicleDialog={showNewVehicleDialog}
        setShowNewVehicleDialog={setShowNewVehicleDialog}
        showNewInventoryDialog={showNewInventoryDialog}
        setShowNewInventoryDialog={setShowNewInventoryDialog}
      />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-4 text-sm font-mono">
          <span className="text-muted-foreground">[SYS_MSG]</span>
          <span className="text-foreground/80 ml-2">DATA_COLLECTION_NOTICE_ACTIVE</span>
        </div>

        <Tabs defaultValue="inventory" className="w-full animate-scale-in">
          <DashboardTabs showHelp={showHelp} />
          <CommandBar />
          {children}
        </Tabs>

        <DashboardFooter />
      </main>
    </div>
  );
};