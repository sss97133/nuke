
import { NavigateFunction } from "react-router-dom";
import type { ToastFunction } from "../types";

export const handleHelpMenuAction = (
  navigate: NavigateFunction,
  toast: ToastFunction,
  action: string
) => {
  switch (action) {
    case 'documentation':
      // Documentation is now handled by the popup, no navigation needed
      console.log('Documentation popup should be shown via the menu component');
      break;
    case 'keyboard_shortcuts':
      toast({
        title: 'Keyboard Shortcuts',
        description: 'Coming soon: Keyboard shortcuts documentation'
      });
      break;
    case 'about':
      // About is now handled by the popup, no navigation needed
      console.log('About popup should be shown via the menu component');
      break;
    default:
      console.warn(`Unhandled help menu action: ${action}`);
  }
};
