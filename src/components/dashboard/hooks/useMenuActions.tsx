
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { handleExport } from "./utils/exportUtils";
import { handleSignOut, handleKeyboardShortcuts, handleProjectNavigation } from "./utils/navigationUtils";
import { handleToggleUIElement, handleDialogActions, handleDocumentation } from "./utils/uiUtils";

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
    // Handle project navigation
    if (['new_project', 'professional_dashboard', 'skill_management', 'achievements', 
         'preferences', 'inventory_view', 'service_view', 'vin_scanner', 
         'market_analysis', 'studio_workspace', 'streaming_setup'].includes(action)) {
      handleProjectNavigation(navigate, toast, action);
      return;
    }

    // Handle dialogs
    if (['new_vehicle', 'new_inventory', 'studio_config'].includes(action)) {
      handleDialogActions(
        setShowNewVehicleDialog,
        setShowNewInventoryDialog,
        setShowStudioConfig,
        setShowWorkspacePreview,
        toast,
        action
      );
      return;
    }

    // Handle documentation
    if (['documentation', 'about'].includes(action)) {
      handleDocumentation(toast, action);
      return;
    }

    // Handle remaining actions
    switch (action) {
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
      case 'keyboard_shortcuts':
        handleKeyboardShortcuts(toast);
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

