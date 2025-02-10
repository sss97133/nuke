
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

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
        try {
          const { data: user } = await supabase.auth.getUser();
          if (!user?.user?.id) {
            throw new Error('User not authenticated');
          }
          
          const { data: exportData, error } = await supabase
            .from('vehicles')
            .select('*')
            .eq('user_id', user.user.id);
            
          if (error) throw error;
          
          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'export.json';
          a.click();
          
          toast({
            title: "Export Successful",
            description: "Your data has been exported successfully",
          });
        } catch (error) {
          toast({
            title: "Export Failed",
            description: "Unable to export data. Please try again.",
            variant: "destructive",
          });
        }
        break;
      case 'toggle_assistant':
        setShowAiAssistant(!showAiAssistant);
        toast({
          title: "AI Assistant",
          description: `AI Assistant ${!showAiAssistant ? 'enabled' : 'disabled'}`
        });
        break;
      case 'help':
        setShowHelp(!showHelp);
        break;
      case 'exit':
        const confirmed = window.confirm('Are you sure you want to exit?');
        if (confirmed) {
          await supabase.auth.signOut();
          navigate('/login');
          toast({
            title: "Signed Out",
            description: "You have been signed out successfully"
          });
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
        setShowWorkspacePreview(true);
        toast({
          title: "Studio Configuration",
          description: "Opening studio configuration panel",
        });
        break;
      case 'toggle_workspace':
        setShowWorkspacePreview(!showWorkspacePreview);
        toast({
          title: "Workspace Preview",
          description: `Workspace preview ${!showWorkspacePreview ? 'enabled' : 'disabled'}`
        });
        break;
      case 'toggle_theme':
        setDarkMode(!darkMode);
        document.documentElement.classList.toggle('dark');
        toast({
          title: "Theme Updated",
          description: `Switched to ${!darkMode ? 'dark' : 'light'} mode`
        });
        break;
      case 'toggle_sidebar':
        setShowSidebar(!showSidebar);
        toast({
          title: "Sidebar Toggled",
          description: `Sidebar ${!showSidebar ? 'shown' : 'hidden'}`
        });
        break;
      case 'toggle_activity':
        setShowActivityPanel(!showActivityPanel);
        toast({
          title: "Activity Panel",
          description: `Activity panel ${!showActivityPanel ? 'shown' : 'hidden'}`
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
        window.open('https://docs.example.com', '_blank');
        break;
      case 'keyboard_shortcuts':
        toast({
          title: "Keyboard Shortcuts",
          description: [
            "⌘K - Open Command Bar",
            "⌘/ - Toggle Help",
            "⌘B - Toggle Sidebar",
            "⌘T - Toggle Theme",
            "⌘\\ - Toggle Activity Panel"
          ].join('\n'),
        });
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
