import React, { useState } from 'react';
import { StudioWorkspace } from './StudioWorkspace';
import { StudioConfigForm } from './StudioConfigForm';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Camera, Video, Settings, Layout } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FormData {
  length: number;
  width: number;
  height: number;
  ptzTracks: {
    x: number;
    y: number;
    z: number;
    length: number;
    speed: number;
    coneAngle: number;
  }[];
}

export const StudioConfiguration = () => {
  const [dimensions, setDimensions] = useState({
    length: 30,
    width: 20,
    height: 16,
  });
  const { toast } = useToast();

  const [ptzTracks, setPtzTracks] = useState([
    {
      position: { x: 0, y: 8, z: 0 },
      length: 10,
      speed: 1,
      coneAngle: 45
    }
  ]);

  const [selectedCamera, setSelectedCamera] = useState<number | null>(null);

  const handleConfigUpdate = (data: FormData) => {
    setDimensions({
      length: Number(data.length) || 30,
      width: Number(data.width) || 20,
      height: Number(data.height) || 16,
    });

    if (data.ptzTracks?.[0]) {
      setPtzTracks([
        {
          position: {
            x: Number(data.ptzTracks[0].x) || 0,
            y: Number(data.ptzTracks[0].y) || 8,
            z: Number(data.ptzTracks[0].z) || 0,
          },
          length: Number(data.ptzTracks[0].length) || 10,
          speed: Number(data.ptzTracks[0].speed) || 1,
          coneAngle: Number(data.ptzTracks[0].coneAngle) || 45,
        },
      ]);
    }
  };

  const handleCameraSelect = (index: number) => {
    setSelectedCamera(index);
    toast({
      title: "Camera Selected",
      description: `Switched to camera ${index + 1}`,
    });
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="preview" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-4">
          <TabsTrigger value="preview" className="flex items-center gap-2">
            <Video className="w-4 h-4" />
            Live Preview
          </TabsTrigger>
          <TabsTrigger value="cameras" className="flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Camera Controls
          </TabsTrigger>
          <TabsTrigger value="workspace" className="flex items-center gap-2">
            <Layout className="w-4 h-4" />
            3D Workspace
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {ptzTracks.map((_, index) => (
              <Card 
                key={index}
                className={`p-4 cursor-pointer transition-all ${
                  selectedCamera === index ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => handleCameraSelect(index)}
              >
                <div className="aspect-video bg-muted flex items-center justify-center">
                  <p className="text-muted-foreground">Camera {index + 1} Feed</p>
                </div>
                <div className="mt-2 flex justify-between items-center">
                  <span className="text-sm font-medium">PTZ Camera {index + 1}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectedCamera === index ? 'Selected' : 'Click to select'}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="cameras" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Camera Controls</h3>
            {selectedCamera !== null ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Pan/Tilt Controls</h4>
                    <div className="aspect-square bg-muted rounded-full"></div>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium mb-2">Zoom Controls</h4>
                    <div className="h-full bg-muted rounded-lg"></div>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2">Presets</h4>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((preset) => (
                      <button
                        key={preset}
                        className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded"
                      >
                        Preset {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Select a camera to control</p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="workspace" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Studio Configuration</h2>
              <StudioConfigForm 
                onUpdate={handleConfigUpdate} 
                initialData={{ 
                  dimensions, 
                  ptzTracks 
                }} 
              />
            </Card>
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Workspace Preview</h2>
              <StudioWorkspace dimensions={dimensions} ptzTracks={ptzTracks} />
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Camera Settings</h3>
            {selectedCamera !== null ? (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">Video Settings</h4>
                  <div className="space-y-2">
                    <div>Resolution: 1920x1080</div>
                    <div>Framerate: 60fps</div>
                    <div>Bitrate: 5000kbps</div>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2">Network Settings</h4>
                  <div className="space-y-2">
                    <div>IP: 192.168.1.100</div>
                    <div>Protocol: RTSP</div>
                    <div>Port: 554</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Select a camera to view settings</p>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};