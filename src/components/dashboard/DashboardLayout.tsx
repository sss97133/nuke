import { Tabs } from "@/components/ui/tabs";
import { CommandBar } from "./CommandBar";
import { ReactNode, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DashboardHeader } from "./header/DashboardHeader";
import { DashboardTabs } from "./tabs/DashboardTabs";
import { ActivityFeed } from "./ActivityFeed";
import { FormDialogs } from "./dialogs/FormDialogs";
import { MendableChat } from "../ai/MendableChat";
import { useNavigate } from "react-router-dom";
import { StudioConfiguration } from "../studio/StudioConfiguration";
import { StudioWorkspace } from "../studio/StudioWorkspace";

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
  const [showStudioConfigV1, setShowStudioConfigV1] = useState(false);

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
          description: "Opening preferences settings..."
        });
        // Preferences dialog will be implemented later
        break;
      case 'studio_config':
        setShowStudioConfig(true);
        setShowStudioConfigV1(false);
        break;
      case 'studio_config_v1':
        setShowStudioConfigV1(true);
        setShowStudioConfig(false);
        break;
      case 'toggle_theme':
        document.documentElement.classList.toggle('dark');
        toast({
          title: "Theme Toggled",
          description: "Application theme has been updated",
        });
        break;
      case 'about':
        toast({
          title: "About",
          description: "Vehicle Management System v1.0",
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
    <div className="min-h-screen bg-background text-foreground dark:bg-background-dark dark:text-foreground-dark font-system">
      <DashboardHeader handleMenuAction={handleMenuAction} />
      
      <main className="flex-1 p-6">
        {showStudioConfigV1 ? (
          <div className="w-full h-[600px]">
            <StudioWorkspace 
              dimensions={{ length: 30, width: 20, height: 16 }}
              ptzTracks={[{
                position: { x: 0, y: 8, z: 0 },
                length: 10,
                speed: 1,
                coneAngle: 45
              }]}
            />
          </div>
        ) : showStudioConfig ? (
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

            <div className="mt-6">
              <ActivityFeed />
            </div>
          </>
        )}
      </main>
    </div>
  );
};