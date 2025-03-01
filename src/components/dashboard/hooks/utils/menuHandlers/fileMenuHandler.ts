
import { NavigateFunction } from "react-router-dom";
import type { ToastFunction } from "../types";

export const handleFileMenuAction = (navigate: NavigateFunction, toast: ToastFunction, action: string) => {
  switch (action) {
    case 'new_project':
      toast({
        title: "New Project",
        description: "Creating a new project workspace"
      });
      navigate('/new-project');
      break;
    case 'new_vehicle':
      toast({
        title: "New Vehicle",
        description: "Adding a new vehicle to your garage"
      });
      navigate('/vehicles/new');
      break;
    case 'new_inventory':
      toast({
        title: "New Inventory",
        description: "Adding a new inventory item"
      });
      navigate('/inventory/new');
      break;
    case 'import':
      toast({
        title: "Import",
        description: "Importing data from external sources"
      });
      navigate('/import');
      break;
    case 'export':
      toast({
        title: "Export",
        description: "Exporting data to various formats"
      });
      // Export functionality would typically open a dialog or modal
      break;
    case 'sitemap':
      navigate('/sitemap');
      break;
    case 'glossary':
      navigate('/glossary');
      break;
    case 'exit':
      if (confirm('Are you sure you want to exit the application?')) {
        toast({
          title: "Exiting Application",
          description: "Closing application session"
        });
        // Typically would sign out the user and redirect to login
        navigate('/login');
      }
      break;
    default:
      toast({
        title: "Action Not Implemented",
        description: `The ${action} action is not yet implemented.`,
        variant: "destructive"
      });
  }
};
