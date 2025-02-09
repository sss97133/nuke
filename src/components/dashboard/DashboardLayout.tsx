
import { ReactNode } from "react";
import { DashboardHeader } from "./header/DashboardHeader";
import { MainContent } from "./layout/MainContent";
import { useDashboardState } from "./hooks/useDashboardState";

interface DashboardLayoutProps {
  children?: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  const {
    showNewVehicleDialog,
    setShowNewVehicleDialog,
    showNewInventoryDialog,
    setShowNewInventoryDialog,
    showAiAssistant,
    showStudioConfig,
    showWorkspacePreview,
    showActivityPanel,
    handleShowHelp,
    handleMenuAction
  } = useDashboardState();

  return (
    <div className="min-h-screen bg-background text-foreground dark:bg-background-dark dark:text-foreground-dark font-system">
      <DashboardHeader handleMenuAction={handleMenuAction} />
      <MainContent 
        showNewVehicleDialog={showNewVehicleDialog}
        setShowNewVehicleDialog={setShowNewVehicleDialog}
        showNewInventoryDialog={showNewInventoryDialog}
        setShowNewInventoryDialog={setShowNewInventoryDialog}
        showAiAssistant={showAiAssistant}
        showStudioConfig={showStudioConfig}
        showWorkspacePreview={showWorkspacePreview}
        showActivityPanel={showActivityPanel}
        handleShowHelp={handleShowHelp}
      />
    </div>
  );
};
