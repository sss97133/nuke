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
import { useNavigate } from "react-router-dom";
import { StudioConfiguration } from "../studio/StudioConfiguration";

interface DashboardLayoutProps {
  children?: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [showNewVehicleDialog, setShowNewVehicleDialog] = useState(false);
  const [showNewInventoryDialog, setShowNewInventoryDialog] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showStudioConfig, setShowStudioConfig] = useState(false);

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
      case 'professional_dashboard':
        toast({
          title: "Professional Dashboard",
          description: "Opening professional dashboard...",
        });
        navigate('/professional');
        break;
      case 'skill_management':
        toast({
          title: "Skill Management",
          description: "Opening skill management...",
        });
        navigate('/skills');
        break;
      case 'achievements':
        toast({
          title: "Achievements",
          description: "Opening achievements...",
        });
        navigate('/achievements');
        break;
      case 'preferences':
        toast({ 
          title: "Preferences",
          description: "Preferences dialog will be implemented soon."
        });
        break;
      case 'studio_config':
        setShowStudioConfig(true);
        break;
      default:
        toast({ 
          title: `${action} selected`,
          description: "This feature will be implemented soon."
        });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground dark:bg-background-dark dark:text-foreground-dark font-system">
      <DashboardHeader handleMenuAction={handleMenuAction} />
      
      <main className="flex-1 p-6">
        {showStudioConfig ? (
          <StudioConfiguration />
        ) : (
          <>
            <FormDialogs
              showNewVehicleDialog={showNewVehicleDialog}
              setShowNewVehicleDialog={setShowNewVehicleDialog}
              showNewInventoryDialog={showNewInventoryDialog}
              setShowNewInventoryDialog={setShowNewInventoryDialog}
            />

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
          </>
        )}
      </main>
    </div>
  );
};
