
import { NavigateFunction } from "react-router-dom";
import type { ToastFunction } from "./types";
import { handleFileMenuAction } from "./menuHandlers/fileMenuHandler";
import { handleEditMenuAction } from "./menuHandlers/editMenuHandler";
import { handleViewMenuAction } from "./menuHandlers/viewMenuHandler";
import { handleToolsMenuAction } from "./menuHandlers/toolsMenuHandler";
import { handleWindowMenuAction } from "./menuHandlers/windowMenuHandler";
import { handleHelpMenuAction } from "./menuHandlers/helpMenuHandler";
import { 
  handleProjectNavigation, 
  handleSignOut, 
  handleNavigateToProfile 
} from "./menuHandlers/profileHandler";
import { handleKeyboardShortcuts } from "./menuHandlers/keyboardHandler";

// Export all handlers for use in the application
export {
  handleFileMenuAction,
  handleEditMenuAction,
  handleViewMenuAction,
  handleToolsMenuAction,
  handleWindowMenuAction,
  handleHelpMenuAction,
  handleProjectNavigation,
  handleSignOut,
  handleNavigateToProfile,
  handleKeyboardShortcuts
};
