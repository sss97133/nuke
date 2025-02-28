
import { toast } from "sonner";
import { NavigateFunction } from "react-router-dom";
import type { ToastFunction } from "./types";

export const handleKeyboardShortcuts = (toast: ToastFunction) => {
  toast({
    title: "Keyboard Shortcuts",
    description: "Press '?' to view all available keyboard shortcuts",
  });
};

export const handleProjectNavigation = (navigate: NavigateFunction, toast: ToastFunction, project: string) => {
  switch (project) {
    case 'preferences':
      navigate('/dashboard/settings');
      break;
    case 'import':
      navigate('/dashboard/import');
      break;
    case 'glossary':
      navigate('/dashboard/glossary');
      break;
    case 'sitemap':
      navigate('/dashboard/sitemap');
      break;
    case 'documentation':
      navigate('/dashboard/documentation');
      break;
    default:
      toast({
        title: "Navigation Error",
        description: `Unknown project: ${project}`,
        variant: "destructive"
      });
  }
};

export const handleSignOut = (navigate: NavigateFunction, toast: ToastFunction) => {
  // Simulate sign out
  toast({
    title: "Signed Out",
    description: "You have been signed out of the application"
  });
  
  // Navigate to login page
  navigate('/login');
};

export const handleNavigateToProfile = (navigate: NavigateFunction) => {
  navigate('/dashboard/profile');
};
