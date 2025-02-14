
import { ToastFunction } from "./types";

export const handleToggleUIElement = (
  toggle: React.Dispatch<React.SetStateAction<boolean>>,
  currentState: boolean,
  toastMessage: { title: string; description: string },
  toast: ToastFunction
) => {
  toggle(!currentState);
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
      break;
    case 'new_inventory':
      setShowNewInventoryDialog(true);
      break;
    case 'studio_config':
      setShowStudioConfig(true);
      setShowWorkspacePreview(true);
      toast({
        title: "Studio Configuration",
        description: "Opening studio configuration panel",
      });
      break;
  }
};

export const handleDocumentation = (toast: ToastFunction, action: string) => {
  switch (action) {
    case 'documentation':
      return 'token_analytics';  // Return action for navigation
    case 'about':
      toast({
        title: "About NUKE",
        description: "Vehicle Management System v1.0\nBuilt with ❤️",
      });
      break;
  }
};

