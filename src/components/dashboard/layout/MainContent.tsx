
import { ReactNode } from "react";
import { FormDialogs } from "../dialogs/FormDialogs";
import { MendableChat } from "../../ai/MendableChat";
import { StudioConfiguration } from "../../studio/StudioConfiguration";
import { StudioWorkspace } from "../../studio/StudioWorkspace";
import type { PTZTrack } from "@/components/studio/types/workspace";

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
  children?: ReactNode;
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
  children,
}: MainContentProps) => {
  return (
    <main className="flex-1 p-6 bg-background">
      {showStudioConfig ? (
        <div className="space-y-6">
          <StudioConfiguration />
          {showWorkspacePreview && (
            <div className="mt-6 w-full h-[600px] border border-border rounded-lg shadow-classic">
              <StudioWorkspace 
                dimensions={{ length: 30, width: 20, height: 16 }}
                ptzTracks={[{
                  id: "preview-camera-1",
                  name: "Preview Camera",
                  position: { x: 0, y: 8, z: 0 },
                  rotation: { x: 0, y: 0, z: 0 },
                  target: { x: 0, y: 5, z: 0 },
                  length: 10,
                  speed: 1,
                  coneAngle: 45,
                  zoom: 1
                }]}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="relative">
          <FormDialogs
            showNewVehicleDialog={showNewVehicleDialog}
            setShowNewVehicleDialog={setShowNewVehicleDialog}
            showNewInventoryDialog={showNewInventoryDialog}
            setShowNewInventoryDialog={setShowNewInventoryDialog}
          />

          {showAiAssistant && (
            <div className="fixed bottom-4 right-4 w-96 z-50">
              <MendableChat />
            </div>
          )}

          {children}
        </div>
      )}
    </main>
  );
};
