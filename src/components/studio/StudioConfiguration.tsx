
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { StudioConfigForm } from './StudioConfigForm';
import { StudioWorkspace } from './StudioWorkspace';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AudioControls } from './controls/AudioControls';
import { CameraControls } from './controls/CameraControls';
import { PTZControls } from './controls/PTZControls';
import { RecordingControls } from './controls/RecordingControls';
import { StreamingControls } from './controls/StreamingControls';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, Info, Settings, Save, Camera } from 'lucide-react';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import type { WorkspaceDimensions, PTZTrack } from '@/types/studio';
import { toJson } from '@/types/json';

export const StudioConfiguration = () => {
  const { toast } = useToast();
  const defaultDimensions: WorkspaceDimensions = {
    length: 30,
    width: 20,
    height: 16
  };

  const { data: studioConfig, isLoading, error } = useStudioConfig(defaultDimensions);
  const [dimensions, setDimensions] = useState<WorkspaceDimensions>(defaultDimensions);
  const [ptzTracks, setPTZTracks] = useState<PTZTrack[]>([{
    position: { x: 0, y: 8, z: 0 },
    length: 10,
    speed: 1,
    coneAngle: 45,
  }]);
  
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState<number[]>([50]);
  const [activeTab, setActiveTab] = useState('simulator');
  const [isAutoSave, setIsAutoSave] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    if (studioConfig) {
      setDimensions(studioConfig.workspace_dimensions);
      setPTZTracks(studioConfig.ptz_configurations.tracks);
    }
  }, [studioConfig]);

  const handleUpdate = async (data: {
    length: number;
    width: number;
    height: number;
    ptzTracks: PTZTrack[];
  }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const { error } = await supabase
        .from('studio_configurations')
        .upsert({
          user_id: user.id,
          name: 'Default Configuration',
          workspace_dimensions: toJson({
            length: data.length,
            width: data.width,
            height: data.height
          }),
          ptz_configurations: toJson({
            tracks: data.ptzTracks,
            planes: { walls: [], ceiling: {} },
            roboticArms: []
          })
        });

      if (error) throw error;
      
      setLastSaved(new Date());

      toast({
        title: "Configuration Saved",
        description: "Studio configuration updated successfully",
      });
    } catch (error) {
      console.error('Error:', error);
      toast({
        title: "Error",
        description: "Failed to update studio configuration",
        variant: "destructive",
      });
    }
  };
  
  // Auto-save when dimensions or ptzTracks change
  useEffect(() => {
    if (isAutoSave && lastSaved && (Date.now() - lastSaved.getTime() > 5000)) {
      handleUpdate({
        length: dimensions.length,
        width: dimensions.width,
        height: dimensions.height,
        ptzTracks
      });
    }
  }, [dimensions, ptzTracks, isAutoSave]);

  // Handle camera selection
  const handleCameraSelect = (index: number) => {
    setSelectedCameraIndex(index);
    
    toast({
      title: "Camera Selected",
      description: `Now controlling camera ${index + 1}`,
    });
  };
  
  // Handle saving the current configuration as a preset
  const handleSavePreset = () => {
    const presetName = prompt("Enter preset name:", "Studio Configuration " + new Date().toLocaleDateString());
    
    if (presetName) {
      // Save the preset
      toast({
        title: "Preset Saved",
        description: `"${presetName}" saved successfully`,
      });
    }
  };

  // Camera control handlers
  const handlePTZMove = (direction: string) => {
    console.log(`Moving camera ${selectedCameraIndex} in direction: ${direction}`);
    // Implement actual camera movement logic here
  };

  const handleCameraZoom = (level: number) => {
    console.log(`Setting zoom level to: ${level}`);
    // Implement actual zoom logic here
  };

  const handleAudioLevelChange = (index: number, level: number) => {
    const newLevels = [...audioLevel];
    newLevels[index] = level;
    setAudioLevel(newLevels);
    console.log(`Setting audio channel ${index} to level: ${level}`);
  };

  const handleStartRecording = () => {
    console.log('Started recording');
    toast({
      title: "Recording Started",
      description: "Studio recording is now in progress",
    });
  };

  const handleStopRecording = () => {
    console.log('Stopped recording');
    toast({
      title: "Recording Stopped",
      description: "Studio recording has been stopped",
    });
  };

  const handleStartStreaming = () => {
    console.log('Started streaming');
    toast({
      title: "Stream Started",
      description: "Studio stream is now live",
    });
  };

  const handleStopStreaming = () => {
    console.log('Stopped streaming');
    toast({
      title: "Stream Ended",
      description: "Studio stream has been stopped",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading studio configuration...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-[500px]">
          <CardHeader>
            <CardTitle className="flex items-center text-destructive">
              <AlertCircle className="h-5 w-5 mr-2" /> Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p>Failed to load studio configuration. Please try again later.</p>
            <Button className="mt-4" onClick={() => window.location.reload()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Studio Configuration</h1>
          <p className="text-muted-foreground">Configure your virtual studio for production</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center space-x-2">
            <Switch 
              id="auto-save" 
              checked={isAutoSave} 
              onCheckedChange={setIsAutoSave}
            />
            <Label htmlFor="auto-save">Auto-save</Label>
          </div>
          <Button onClick={handleSavePreset} variant="outline">
            <Save className="h-4 w-4 mr-2" />
            Save as Preset
          </Button>
          <Button onClick={() => handleUpdate({
            length: dimensions.length,
            width: dimensions.width,
            height: dimensions.height,
            ptzTracks
          })}>
            Save Configuration
          </Button>
        </div>
      </div>
      
      {lastSaved && (
        <p className="text-xs text-muted-foreground text-right">
          Last saved: {lastSaved.toLocaleTimeString()}
        </p>
      )}
      
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="simulator">
            <Camera className="h-4 w-4 mr-2" />
            Simulator
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="simulator" className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Card className="h-[600px]">
                <CardContent className="p-0 h-full">
                  <StudioWorkspace 
                    dimensions={dimensions}
                    ptzTracks={ptzTracks}
                    onSelectCamera={handleCameraSelect}
                    selectedCameraIndex={selectedCameraIndex}
                  />
                </CardContent>
              </Card>
            </div>
            
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Camera Controls
                    {selectedCameraIndex !== null && (
                      <Badge variant="outline">Camera {selectedCameraIndex + 1}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedCameraIndex === null ? (
                    <div className="text-center py-6 text-muted-foreground">
                      <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Select a camera in the simulator to control it</p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <h4 className="font-medium mb-2">PTZ Controls</h4>
                        <PTZControls onMove={handlePTZMove} />
                      </div>
                      
                      <Separator />
                      
                      <div>
                        <h4 className="font-medium mb-2">Camera Settings</h4>
                        <CameraControls onZoom={handleCameraZoom} />
                      </div>
                      
                      <Separator />
                      
                      <div>
                        <h4 className="font-medium mb-2">Audio Levels</h4>
                        <AudioControls 
                          levels={audioLevel} 
                          onLevelChange={handleAudioLevelChange} 
                        />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Recording</CardTitle>
                </CardHeader>
                <CardContent>
                  <RecordingControls 
                    onStart={handleStartRecording} 
                    onStop={handleStopRecording} 
                  />
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Streaming</CardTitle>
                </CardHeader>
                <CardContent>
                  <StreamingControls 
                    onStart={handleStartStreaming} 
                    onStop={handleStopStreaming} 
                  />
                </CardContent>
              </Card>
            </div>
          </div>
          
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center">
                <Info className="h-4 w-4 mr-2" />
                Tips for Studio Setup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>Click on cameras in the simulator to select and control them</li>
                <li>Use PTZ controls to adjust camera position and angle</li>
                <li>Adjust recording settings before starting a session</li>
                <li>Save your configuration as a preset for future use</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="settings">
          <Card>
            <CardContent className="pt-6">
              <StudioConfigForm 
                initialDimensions={dimensions}
                initialPTZTracks={ptzTracks}
                onUpdateDimensions={setDimensions}
                onUpdatePTZTracks={setPTZTracks}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
