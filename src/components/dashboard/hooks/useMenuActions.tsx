
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { handleExport } from "./utils/exportUtils";
import { handleSignOut, handleKeyboardShortcuts } from "./utils/navigationUtils";
import { handleToggleUIElement } from "./utils/uiUtils";

export const useMenuActions = (
  setShowNewVehicleDialog: (show: boolean) => void,
  setShowNewInventoryDialog: (show: boolean) => void,
  setShowAiAssistant: (show: boolean) => void,
  setShowHelp: (show: boolean) => void,
  setShowStudioConfig: (show: boolean) => void,
  setShowWorkspacePreview: (show: boolean) => void,
  showWorkspacePreview: boolean,
  setShowActivityPanel: (show: boolean) => void,
  showActivityPanel: boolean,
  setShowSidebar: (show: boolean) => void,
  showSidebar: boolean,
  setDarkMode: (dark: boolean) => void,
  darkMode: boolean
) => {
  const { toast } = useToast();
  const navigate = useNavigate();

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
        toast({
          title: "New Project",
          description: "Creating new project workspace"
        });
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
        await handleExport(toast);
        break;
      case 'toggle_assistant':
        handleToggleUIElement(
          setShowAiAssistant,
          false,
          {
            title: "AI Assistant",
            description: "AI Assistant status toggled"
          },
          toast
        );
        break;
      case 'help':
        setShowHelp(false);
        break;
      case 'exit':
        await handleSignOut(navigate, toast);
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
        setShowWorkspacePreview(true);
        toast({
          title: "Studio Configuration",
          description: "Opening studio configuration panel",
        });
        break;
      case 'toggle_workspace':
        handleToggleUIElement(
          setShowWorkspacePreview,
          showWorkspacePreview,
          {
            title: "Workspace Preview",
            description: `Workspace preview ${!showWorkspacePreview ? 'enabled' : 'disabled'}`
          },
          toast
        );
        break;
      case 'toggle_theme':
        handleToggleUIElement(
          setDarkMode,
          darkMode,
          {
            title: "Theme Updated",
            description: `Switched to ${!darkMode ? 'dark' : 'light'} mode`
          },
          toast
        );
        document.documentElement.classList.toggle('dark');
        break;
      case 'toggle_sidebar':
        handleToggleUIElement(
          setShowSidebar,
          showSidebar,
          {
            title: "Sidebar Toggled",
            description: `Sidebar ${!showSidebar ? 'shown' : 'hidden'}`
          },
          toast
        );
        break;
      case 'toggle_activity':
        handleToggleUIElement(
          setShowActivityPanel,
          showActivityPanel,
          {
            title: "Activity Panel",
            description: `Activity panel ${!showActivityPanel ? 'shown' : 'hidden'}`
          },
          toast
        );
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
        window.open('https://docs.example.com', '_blank');
        break;
      case 'keyboard_shortcuts':
        handleKeyboardShortcuts(toast);
        break;
      case 'about':
        toast({
          title: "About NUKE",
          description: "Vehicle Management System v1.0\nBuilt with ❤️",
        });
        break;
      default:
        toast({
          title: "Coming Soon",
          description: "This feature is under development",
          variant: "destructive"
        });
    }
  };

  return {
    handleShowHelp,
    handleMenuAction,
  };
};
