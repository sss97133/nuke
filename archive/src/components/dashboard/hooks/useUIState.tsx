
import { useState } from "react";

export const useUIState = () => {
  const [showWorkspacePreview, setShowWorkspacePreview] = useState(true);
  const [showActivityPanel, setShowActivityPanel] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  return {
    showWorkspacePreview,
    setShowWorkspacePreview,
    showActivityPanel,
    setShowActivityPanel,
    showSidebar,
    setShowSidebar,
    darkMode,
    setDarkMode,
  };
};
