
import { useDialogState } from "./useDialogState";
import { useUIState } from "./useUIState";
import { useMenuActions } from "./useMenuActions";

export const useDashboardState = () => {
  const {
    showNewVehicleDialog,
    setShowNewVehicleDialog,
    showNewInventoryDialog,
    setShowNewInventoryDialog,
    showAiAssistant,
    setShowAiAssistant,
    showHelp,
    setShowHelp,
    showStudioConfig,
    setShowStudioConfig,
  } = useDialogState();

  const {
    showWorkspacePreview,
    setShowWorkspacePreview,
    showActivityPanel,
    setShowActivityPanel,
    showSidebar,
    setShowSidebar,
    darkMode,
    setDarkMode,
  } = useUIState();

  // We're just passing the handleMenuAction function from useMenuActions
  const { handleMenuAction } = useMenuActions();

  return {
    showNewVehicleDialog,
    setShowNewVehicleDialog,
    showNewInventoryDialog,
    setShowNewInventoryDialog,
    showAiAssistant,
    showHelp,
    showStudioConfig,
    showWorkspacePreview,
    showActivityPanel,
    showSidebar,
    darkMode,
    handleMenuAction
  };
};
