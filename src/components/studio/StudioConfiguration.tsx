import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Camera, Video, Settings, Layout, Mic2, Radio } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CameraControls } from './controls/CameraControls';
import { AudioControls } from './controls/AudioControls';
import { StreamingControls } from './controls/StreamingControls';
import { PTZControls } from './controls/PTZControls';
import { RecordingControls } from './controls/RecordingControls';
import { PreviewSection } from './sections/PreviewSection';
import { SettingsSection } from './sections/SettingsSection';
import { ControlButtons } from './sections/ControlButtons';
import type { WorkspaceDimensions, PTZConfigurations, isWorkspaceDimensions, isPTZConfigurations } from '@/types/studio';

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

      return {
        id: data?.id || '',
        user_id: user.id,
        name: data?.name || '',
        workspace_dimensions: isWorkspaceDimensions(data?.workspace_dimensions) 
          ? data.workspace_dimensions 
          : dimensions,
        ptz_configurations: isPTZConfigurations(data?.ptz_configurations)
          ? data.ptz_configurations
          : {
              tracks: [],
              planes: { walls: [], ceiling: {} },
              roboticArms: []
            },
        camera_config: data?.camera_config || {},
        audio_config: data?.audio_config || {},
        lighting_config: data?.lighting_config || {},
        fixed_cameras: data?.fixed_cameras || { positions: [] },
        created_at: data?.created_at || new Date().toISOString(),
        updated_at: data?.updated_at || new Date().toISOString()
      };
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

        <ControlButtons
          isRecording={isRecording}
          isStreaming={isStreaming}
          onRecordingToggle={handleRecordingToggle}
          onStreamingToggle={handleStreamingToggle}
        />

        <TabsContent value="preview" className="space-y-4">
          <PreviewSection
            selectedCamera={selectedCamera}
            setSelectedCamera={setSelectedCamera}
          />
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
          <SettingsSection
            dimensions={dimensions}
            setDimensions={setDimensions}
            ptzTracks={studioConfig?.ptz_configurations?.tracks || []}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};