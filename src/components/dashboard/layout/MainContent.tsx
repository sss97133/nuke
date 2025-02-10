
import { ReactNode, useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { CommandBar } from "../CommandBar";
import { DashboardTabs } from "../tabs/DashboardTabs";
import { ActivityFeed } from "../ActivityFeed";
import { FormDialogs } from "../dialogs/FormDialogs";
import { MendableChat } from "../../ai/MendableChat";
import { StudioConfiguration } from "../../studio/StudioConfiguration";
import { StudioWorkspace } from "../../studio/StudioWorkspace";

interface MainContentProps {
  showNewVehicleDialog: boolean;
  setShowNewVehicleDialog: (show: boolean) => void;
  showNewInventoryDialog: boolean;
  setShowNewInventoryDialog: (show: boolean) => void;
  showAiAssistant: boolean;
  showStudioConfig: boolean;
  showWorkspacePreview: boolean;
  showActivityPanel: boolean;
  handleShowHelp: (section: string) => void;
}

export const MainContent = ({
  showNewVehicleDialog,
  setShowNewVehicleDialog,
  showNewInventoryDialog,
  setShowNewInventoryDialog,
  showAiAssistant,
  showStudioConfig,
  showWorkspacePreview,
  showActivityPanel,
  handleShowHelp,
}: MainContentProps) => {
  return (
    <main className="flex-1 p-6">
      {showStudioConfig ? (
        <div className="space-y-6">
          <StudioConfiguration />
          {showWorkspacePreview && (
            <div className="mt-6 w-full h-[600px] border border-border rounded-lg shadow-classic">
              <StudioWorkspace 
                dimensions={{ length: 30, width: 20, height: 16 }}
                ptzTracks={[{
                  position: { x: 0, y: 8, z: 0 },
                  length: 10,
                  speed: 1,
                  coneAngle: 45
                }]}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <FormDialogs
            showNewVehicleDialog={showNewVehicleDialog}
            setShowNewVehicleDialog={setShowNewVehicleDialog}
            showNewInventoryDialog={showNewInventoryDialog}
            setShowNewInventoryDialog={setShowNewInventoryDialog}
          />

          <div className="grid grid-cols-1 gap-4">
            {showAiAssistant && (
              <div className="fixed bottom-4 right-4 w-96 z-50">
                <MendableChat />
              </div>
            )}
          </div>

          <ActivityFeed />

          {!showActivityPanel && (
            <Tabs defaultValue="home" className="w-full animate-scale-in mt-6">
              <DashboardTabs showHelp={handleShowHelp} />
              <CommandBar />
            </Tabs>
          )}
        </>
      )}
    </main>
  );
};
