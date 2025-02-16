
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { StudioConfiguration } from "@/components/studio/StudioConfiguration";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { useStudioConfig } from "@/hooks/useStudioConfig";
import { Loader2 } from "lucide-react";

export const Studio = () => {
  const defaultDimensions = { length: 30, width: 20, height: 16 };
  const { data: studioConfig, isLoading, error } = useStudioConfig(defaultDimensions);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-destructive">Error loading studio configuration</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Studio Configuration</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <StudioConfiguration />
          </Card>
          
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Workspace Preview</h2>
            <StudioWorkspace 
              dimensions={studioConfig?.workspace_dimensions || defaultDimensions}
              ptzTracks={studioConfig?.ptz_configurations?.tracks || []}
            />
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
};

export default Studio;
