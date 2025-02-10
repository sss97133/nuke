
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

  const { handleShowHelp, handleMenuAction } = useMenuActions(
    setShowNewVehicleDialog,
    setShowNewInventoryDialog,
    setShowAiAssistant,
    setShowHelp,
    setShowStudioConfig,
    setShowWorkspacePreview,
    showWorkspacePreview,
    setShowActivityPanel,
    showActivityPanel,
    setShowSidebar,
    showSidebar,
    setDarkMode,
    darkMode
  );

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
    handleShowHelp,
    handleMenuAction
  };
};
