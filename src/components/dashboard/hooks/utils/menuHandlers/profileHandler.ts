
import { NavigateFunction } from "react-router-dom";
import type { ToastFunction } from "../types";

export const handleProjectNavigation = (navigate: NavigateFunction, toast: ToastFunction, project: string) => {
  switch (project) {
    case 'preferences':
      navigate('/settings');
      break;
    case 'import':
      navigate('/import');
      break;
    case 'glossary':
      navigate('/glossary');
      break;
    case 'sitemap':
      navigate('/sitemap');
      break;
    case 'documentation':
      navigate('/documentation');
      break;
    case 'discovered-vehicles':
      navigate('/discovered-vehicles');
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
  navigate('/profile');
};
