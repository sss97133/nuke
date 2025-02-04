import React, { useState } from 'react';
import { StudioWorkspace } from './StudioWorkspace';
import { StudioConfigForm } from './StudioConfigForm';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Camera, Video, Settings, Layout, Mic2, Radio, Share2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const StudioConfiguration = () => {
  const [dimensions, setDimensions] = useState({
    length: 30,
    width: 20,
    height: 16,
  });
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState([50]);

  // Fetch studio configuration
  const { data: studioConfig } = useQuery({
    queryKey: ['studioConfig'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');
      
      const { data, error } = await supabase
        .from('studio_configurations')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error) throw error;
      return data;
    },
    retry: false
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
        <TabsList className="grid w-full grid-cols-6 mb-4">
          <TabsTrigger value="preview" className="flex items-center gap-2">
            <Video className="w-4 h-4" />
            Live Preview
          </TabsTrigger>
          <TabsTrigger value="cameras" className="flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Cameras
          </TabsTrigger>
          <TabsTrigger value="audio" className="flex items-center gap-2">
            <Mic2 className="w-4 h-4" />
            Audio
          </TabsTrigger>
          <TabsTrigger value="streaming" className="flex items-center gap-2">
            <Radio className="w-4 h-4" />
            Streaming
          </TabsTrigger>
          <TabsTrigger value="distribution" className="flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            Distribution
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

        <TabsContent value="audio" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Audio Controls</h3>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Master Volume</Label>
                <Slider
                  value={audioLevel}
                  onValueChange={setAudioLevel}
                  max={100}
                  step={1}
                />
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Noise Reduction</Label>
                  <Switch />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Echo Cancellation</Label>
                  <Switch />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Auto Gain</Label>
                  <Switch />
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="streaming" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Streaming Settings</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>YouTube</Label>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <Label>Twitch</Label>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <Label>Facebook Live</Label>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <Label>Custom RTMP</Label>
                <Switch />
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="distribution" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Content Distribution</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Auto-publish to YouTube</Label>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <Label>Auto-publish to Podcast Platforms</Label>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <Label>Social Media Scheduling</Label>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <Label>Generate Clips</Label>
                <Switch />
              </div>
            </div>
          </Card>
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
