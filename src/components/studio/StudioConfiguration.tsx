import React, { useState } from 'react';
import { StudioWorkspace } from './StudioWorkspace';
import { StudioConfigForm } from './StudioConfigForm';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Camera, Video, Settings, Layout, Mic2, Radio } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CameraControls } from './controls/CameraControls';
import { AudioControls } from './controls/AudioControls';
import { StreamingControls } from './controls/StreamingControls';
import { PTZControls } from './controls/PTZControls';
import { RecordingControls } from './controls/RecordingControls';
import type { StudioConfigurationType, WorkspaceDimensions, PTZConfigurations } from '@/types/studio';

export const StudioConfiguration = () => {
  const [dimensions, setDimensions] = useState<WorkspaceDimensions>({
    length: 30,
    width: 20,
    height: 16,
  });
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState([50]);

  const { data: studioConfig } = useQuery({
    queryKey: ['studioConfig'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');
      
      const { data, error } = await supabase
        .from('studio_configurations')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      const workspaceDimensions = (data?.workspace_dimensions || {
        width: 0,
        height: 0,
        length: 0
      }) as WorkspaceDimensions;

      const ptzConfig = (data?.ptz_configurations || {
        tracks: [],
        planes: { walls: [], ceiling: {} },
        roboticArms: []
      }) as PTZConfigurations;

      const config: StudioConfigurationType = {
        id: data?.id || '',
        user_id: user.id,
        name: data?.name || '',
        workspace_dimensions: workspaceDimensions,
        ptz_configurations: ptzConfig,
        camera_config: (data?.camera_config || {}) as Record<string, any>,
        audio_config: (data?.audio_config || {}) as Record<string, any>,
        lighting_config: (data?.lighting_config || {}) as Record<string, any>,
        fixed_cameras: (data?.fixed_cameras || { positions: [] }) as { positions: any[] },
        created_at: data?.created_at || new Date().toISOString(),
        updated_at: data?.updated_at || new Date().toISOString()
      };

      return config;
    }
  });

  const handleRecordingToggle = () => {
    setIsRecording(!isRecording);
    toast({
      title: isRecording ? "Recording Stopped" : "Recording Started",
      description: isRecording ? "Your session has been saved" : "Recording to local storage",
    });
  };

  const handleStreamingToggle = () => {
    setIsStreaming(!isStreaming);
    toast({
      title: isStreaming ? "Stream Ended" : "Stream Started",
      description: isStreaming ? "Your stream has ended" : "Going live on configured platforms",
    });
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="preview" className="w-full">
        <TabsList className="grid w-full grid-cols-7 mb-4">
          <TabsTrigger value="preview" className="flex items-center gap-2">
            <Video className="w-4 h-4" />
            Live Preview
          </TabsTrigger>
          <TabsTrigger value="cameras" className="flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Cameras
          </TabsTrigger>
          <TabsTrigger value="ptz" className="flex items-center gap-2">
            <Layout className="w-4 h-4" />
            PTZ Controls
          </TabsTrigger>
          <TabsTrigger value="audio" className="flex items-center gap-2">
            <Mic2 className="w-4 h-4" />
            Audio
          </TabsTrigger>
          <TabsTrigger value="streaming" className="flex items-center gap-2">
            <Radio className="w-4 h-4" />
            Streaming
          </TabsTrigger>
          <TabsTrigger value="recording" className="flex items-center gap-2">
            <Video className="w-4 h-4" />
            Recording
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <div className="flex gap-4 mb-6">
          <Button 
            variant={isRecording ? "destructive" : "default"}
            onClick={handleRecordingToggle}
            className="w-32"
          >
            {isRecording ? "Stop Recording" : "Start Recording"}
          </Button>
          <Button 
            variant={isStreaming ? "destructive" : "default"}
            onClick={handleStreamingToggle}
            className="w-32"
          >
            {isStreaming ? "End Stream" : "Go Live"}
          </Button>
        </div>

        <TabsContent value="preview" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((cameraId) => (
              <Card 
                key={cameraId}
                className={`p-4 cursor-pointer transition-all ${
                  selectedCamera === cameraId ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => {
                  setSelectedCamera(cameraId);
                  toast({
                    title: "Camera Selected",
                    description: `Switched to camera ${cameraId}`,
                  });
                }}
              >
                <div className="aspect-video bg-muted flex items-center justify-center">
                  <p className="text-muted-foreground">Camera {cameraId} Feed</p>
                </div>
                <div className="mt-2 flex justify-between items-center">
                  <span className="text-sm font-medium">PTZ Camera {cameraId}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectedCamera === cameraId ? 'Selected' : 'Click to select'}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="cameras">
          <CameraControls />
        </TabsContent>

        <TabsContent value="ptz">
          <PTZControls />
        </TabsContent>

        <TabsContent value="audio">
          <AudioControls audioLevel={audioLevel} setAudioLevel={setAudioLevel} />
        </TabsContent>

        <TabsContent value="streaming">
          <StreamingControls />
        </TabsContent>

        <TabsContent value="recording">
          <RecordingControls />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Studio Configuration</h2>
              <StudioConfigForm 
                onUpdate={(data) => {
                  setDimensions({
                    length: Number(data.length),
                    width: Number(data.width),
                    height: Number(data.height),
                  });
                }}
                initialData={{ 
                  dimensions, 
                  ptzTracks: studioConfig?.ptz_configurations?.tracks || []
                }}
              />
            </Card>
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Workspace Preview</h2>
              <StudioWorkspace 
                dimensions={dimensions} 
                ptzTracks={studioConfig?.ptz_configurations?.tracks || []}
              />
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
