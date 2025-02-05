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
  const [showSidebar, setShowSidebar] = useState(true);
  const [showActivityPanel, setShowActivityPanel] = useState(true);

  const handleShowHelp = (section: string) => {
    setShowHelp(true);
    toast({
      title: `Help for ${section}`,
      description: `Showing help documentation for ${section}`,
    });
  };

  const handleMenuAction = async (action: string) => {
    switch (action) {
      case 'new_project':
        navigate('/projects/new');
        break;
      case 'new_vehicle':
        setShowNewVehicleDialog(true);
        break;
      case 'new_inventory':
        setShowNewInventoryDialog(true);
        break;
      case 'import':
        navigate('/import');
        break;
      case 'export':
        // Download current data as JSON
        const { data: exportData } = await supabase
          .from('vehicles')
          .select('*')
          .eq('user_id', supabase.auth.getUser());
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'export.json';
        a.click();
        break;
      case 'toggle_assistant':
        setShowAiAssistant(!showAiAssistant);
        break;
      case 'help':
        setShowHelp(!showHelp);
        break;
      case 'exit':
        if (confirm('Are you sure you want to exit?')) {
          await supabase.auth.signOut();
          navigate('/login');
        }
        break;
      case 'professional_dashboard':
        navigate('/professional');
        break;
      case 'skill_management':
        navigate('/skills');
        break;
      case 'achievements':
        navigate('/achievements');
        break;
      case 'preferences':
        navigate('/settings');
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
      case 'toggle_sidebar':
        setShowSidebar(!showSidebar);
        toast({
          title: "Sidebar Toggled",
          description: `Sidebar is now ${!showSidebar ? 'visible' : 'hidden'}`,
        });
        break;
      case 'toggle_activity':
        setShowActivityPanel(!showActivityPanel);
        toast({
          title: "Activity Panel Toggled",
          description: `Activity panel is now ${!showActivityPanel ? 'visible' : 'hidden'}`,
        });
        break;
      case 'inventory_view':
        navigate('/inventory');
        break;
      case 'service_view':
        navigate('/service');
        break;
      case 'vin_scanner':
        navigate('/vin-scanner');
        break;
      case 'market_analysis':
        navigate('/market-analysis');
        break;
      case 'studio_workspace':
        navigate('/studio');
        break;
      case 'streaming_setup':
        navigate('/streaming');
        break;
      case 'documentation':
        window.open('/docs', '_blank');
        break;
      case 'keyboard_shortcuts':
        toast({
          title: "Keyboard Shortcuts",
          description: "⌘K - Open Command Bar\n⌘/ - Toggle Help\n⌘B - Toggle Sidebar",
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
          description: "This feature will be implemented soon.",
        });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground dark:bg-background-dark dark:text-foreground-dark font-system">
      <DashboardHeader handleMenuAction={handleMenuAction} />
      
      <main className={`flex-1 p-6 ${showSidebar ? 'ml-64' : ''}`}>
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

            {showActivityPanel && (
              <div className="mt-6">
                <ActivityFeed />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};