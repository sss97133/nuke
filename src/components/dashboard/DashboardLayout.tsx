import { Tabs } from "@/components/ui/tabs";
import { CommandBar } from "./CommandBar";
import { ReactNode, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DashboardHeader } from "./header/DashboardHeader";
import { DashboardTabs } from "./tabs/DashboardTabs";
import { DashboardFooter } from "./footer/DashboardFooter";
import { FormDialogs } from "./dialogs/FormDialogs";
import { MendableChat } from "../ai/MendableChat";

interface DashboardLayoutProps {
  children?: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const { toast } = useToast();
  const [showNewVehicleDialog, setShowNewVehicleDialog] = useState(false);
  const [showNewInventoryDialog, setShowNewInventoryDialog] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleShowHelp = (section: string) => {
    setShowHelp(true);
    toast({
      title: `Help for ${section}`,
      description: `Showing help documentation for ${section}`,
    });
  };

  const handleMenuAction = (action: string) => {
    switch (action) {
      case 'new_vehicle':
        setShowNewVehicleDialog(true);
        break;
      case 'new_inventory':
        setShowNewInventoryDialog(true);
        break;
      case 'toggle_assistant':
        setShowAiAssistant(!showAiAssistant);
        break;
      case 'help':
        setShowHelp(!showHelp);
        break;
      case 'exit':
        if (confirm('Are you sure you want to exit?')) {
          supabase.auth.signOut();
        }
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

  return (
    <div className="min-h-screen bg-background dark:bg-background-dark text-foreground dark:text-foreground-dark font-system animate-fade-in">
      <DashboardHeader handleMenuAction={handleMenuAction} />

      <FormDialogs
        showNewVehicleDialog={showNewVehicleDialog}
        setShowNewVehicleDialog={setShowNewVehicleDialog}
        showNewInventoryDialog={showNewInventoryDialog}
        setShowNewInventoryDialog={setShowNewInventoryDialog}
      />

      <main className="max-w-7xl mx-auto px-4 py-6 bg-background dark:bg-background-dark">
        <div className="grid grid-cols-1 gap-4">
          {showAiAssistant && (
            <div className="fixed bottom-4 right-4 w-96 z-50">
              <MendableChat />
            </div>
          )}
        </div>

        <Tabs defaultValue="inventory" className="w-full animate-scale-in">
          <DashboardTabs showHelp={handleShowHelp} />
          <CommandBar />
          {children}
        </Tabs>

        <DashboardFooter />
      </main>
    </div>
  );
};