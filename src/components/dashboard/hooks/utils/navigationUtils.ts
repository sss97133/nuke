import { NavigateFunction } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ToastFunction } from "./types";

export const handleSignOut = async (navigate: NavigateFunction, toast: ToastFunction) => {
  const confirmed = window.confirm('Are you sure you want to exit?');
  if (confirmed) {
    await supabase.auth.signOut();
    navigate('/login');
    toast({
      title: "Signed Out",
      description: "You have been signed out successfully"
    });
  }
};

export const handleKeyboardShortcuts = (toast: ToastFunction) => {
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
};

export const handleProjectNavigation = (navigate: NavigateFunction, toast: ToastFunction, action: string) => {
  switch (action) {
    case 'new_project':
      navigate('/projects/new');
      toast({
        title: "New Project",
        description: "Creating new project workspace"
      });
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
  }
};
