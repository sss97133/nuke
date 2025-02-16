
import { ToastFunction } from "./types";

export const handleToggleUIElement = (
  setter: (value: boolean) => void,
  currentValue: boolean,
  toastMessage: { title: string; description: string },
  toast: ToastFunction
) => {
  setter(!currentValue);
  toast(toastMessage);
};

export const handleDialogActions = (
  setShowNewVehicleDialog: (show: boolean) => void,
  setShowNewInventoryDialog: (show: boolean) => void,
  setShowStudioConfig: (show: boolean) => void,
  setShowWorkspacePreview: (show: boolean) => void,
  toast: ToastFunction,
  action: string
) => {
  switch (action) {
    case 'new_vehicle':
      setShowNewVehicleDialog(true);
      toast({
        title: "New Vehicle",
        description: "Opening new vehicle form"
      });
      break;
    case 'new_inventory':
      setShowNewInventoryDialog(true);
      toast({
        title: "New Inventory",
        description: "Opening new inventory form"
      });
      break;
    case 'studio_config':
      setShowStudioConfig(true);
      setShowWorkspacePreview(true);
      toast({
        title: "Studio Configuration",
        description: "Opening studio configuration"
      });
      break;
    default:
      console.error('Unknown dialog action:', action);
  }
};

export const handleDocumentation = (toast: ToastFunction, action: string) => {
  switch (action) {
    case 'documentation':
      toast({
        title: "Documentation",
        description: "Opening documentation in new tab"
      });
      window.open('https://docs.lovable.dev', '_blank');
      break;
    case 'about':
      toast({
        title: "About",
        description: "Opening about page"
      });
      return 'ai_explanations';
    default:
      console.error('Unknown documentation action:', action);
  }
};
