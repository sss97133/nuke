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
import { Sidebar, SidebarContent, SidebarGroup, SidebarHeader, SidebarProvider } from "@/components/ui/sidebar";
import { Car, Warehouse, Wrench, Building2, UserRound, FolderKanban } from "lucide-react";

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

  const features = [
    {
      name: "Inventory",
      icon: Warehouse,
      path: "/inventory",
      description: "Manage parts and supplies"
    },
    {
      name: "Vehicles",
      icon: Car,
      path: "/vehicles",
      description: "Track and manage vehicles"
    },
    {
      name: "Service",
      icon: Wrench,
      path: "/service",
      description: "Service tickets and maintenance"
    },
    {
      name: "Projects",
      icon: FolderKanban,
      path: "/projects",
      description: "Project management and tracking"
    },
    {
      name: "Garages",
      icon: Building2,
      path: "/garages",
      description: "Garage locations and management"
    },
    {
      name: "Professional",
      icon: UserRound,
      path: "/professional",
      description: "Professional development"
    }
  ];

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
      
      <div className="flex">
        <SidebarProvider>
          <Sidebar className="h-[calc(100vh-4rem)] border-r">
            <SidebarHeader className="p-4">
              <h2 className="text-lg font-semibold">Features</h2>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                {features.map((feature) => (
                  <button
                    key={feature.name}
                    onClick={() => navigate(feature.path)}
                    className="w-full flex items-center gap-3 px-4 py-2 hover:bg-accent transition-colors"
                  >
                    <feature.icon className="w-5 h-5" />
                    <div className="text-left">
                      <div className="font-medium">{feature.name}</div>
                      <div className="text-xs text-muted-foreground">{feature.description}</div>
                    </div>
                  </button>
                ))}
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
        </SidebarProvider>

        <main className="flex-1 p-6">
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
        </main>
      </div>
    </div>
  );
};