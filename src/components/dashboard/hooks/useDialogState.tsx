
import { useState } from "react";

export const useDialogState = () => {
  const [showNewVehicleDialog, setShowNewVehicleDialog] = useState(false);
  const [showNewInventoryDialog, setShowNewInventoryDialog] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showStudioConfig, setShowStudioConfig] = useState(false);

  return {
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
  };
};
