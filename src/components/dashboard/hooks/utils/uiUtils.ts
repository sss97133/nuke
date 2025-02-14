
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
      toast({
        title: "Documentation",
        description: [
          "Key Features:",
          "• Vehicle Management - Add, edit, and track vehicles",
          "• Inventory System - Manage parts and supplies",
          "• Service Tracking - Schedule and monitor maintenance",
          "• Token Management - Handle digital assets",
          "• DAO Governance - Participate in decision making",
          "\nFor detailed guides, check the Help menu or press ⌘/"
        ].join('\n')
      });
      break;
    case 'about':
      toast({
        title: "About NUKE",
        description: "Vehicle Management System v1.0\nBuilt with ❤️",
      });
      break;
  }
};

