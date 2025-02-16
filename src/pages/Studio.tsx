
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { StudioConfiguration } from "@/components/studio/StudioConfiguration";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";

export const Studio = () => {
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
              dimensions={{ length: 30, width: 20, height: 16 }}
              ptzTracks={[{
                position: { x: 0, y: 8, z: 0 },
                length: 10,
                speed: 1,
                coneAngle: 45
              }]}
            />
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
};

export default Studio;
