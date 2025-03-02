
import React, { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Info, Settings, Save, Camera } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import { StudioConfigForm } from './StudioConfigForm';
import { StudioWorkspace } from './StudioWorkspace';
import { AudioControls } from './controls/AudioControls';
import { CameraControls } from './controls/CameraControls';
import { PTZControls } from './controls/PTZControls';
import { RecordingControls } from './controls/RecordingControls';
import { StreamingControls } from './controls/StreamingControls';
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

  if (isLoading) {
    return <div className="p-8 flex items-center justify-center">
      <div className="animate-spin mr-2">
        <Settings size={24} />
      </div>
      <span>Loading studio configuration...</span>
    </div>;
  }

  if (error) {
    return <div className="p-8 flex items-center justify-center text-destructive">
      <AlertCircle className="mr-2" />
      <span>Error loading configuration: {error.message}</span>
    </div>;
  }

  return (
    <div className="container max-w-7xl pb-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Studio Configuration</h2>
          <p className="text-muted-foreground">
            Customize your studio workspace and camera setups
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Switch 
              id="auto-save" 
              checked={isAutoSave} 
              onCheckedChange={setIsAutoSave} 
            />
            <Label htmlFor="auto-save">Auto-save</Label>
          </div>
          <Button 
            variant="outline" 
            onClick={handleSavePreset}
          >
            <Save className="mr-2 h-4 w-4" />
            Save As Preset
          </Button>
          <Button
            onClick={() => handleUpdate({ 
              length: dimensions.length, 
              width: dimensions.width, 
              height: dimensions.height,
              ptzTracks
            })}
          >
            <Save className="mr-2 h-4 w-4" />
            Save Configuration
          </Button>
        </div>
      </div>

      {lastSaved && (
        <div className="mb-4 text-sm text-muted-foreground text-right">
          Last saved: {lastSaved.toLocaleTimeString()}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="w-full flex mb-8">
          <TabsTrigger value="simulator" className="flex-1">
            <Camera className="mr-2 h-4 w-4" />
            Studio Simulator
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex-1">
            <Settings className="mr-2 h-4 w-4" />
            Configuration Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="simulator" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-3">
              <Card className="border rounded-lg overflow-hidden h-[500px]">
                <StudioWorkspace
                  dimensions={dimensions}
                  ptzTracks={ptzTracks}
                  onSelectCamera={handleCameraSelect}
                  selectedCameraIndex={selectedCameraIndex}
                />
              </Card>
            </div>
            <div className="md:col-span-1 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center">
                    <Settings className="mr-2 h-4 w-4" />
                    Controls
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {selectedCameraIndex !== null ? (
                    <>
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">Selected Camera</h3>
                        <Badge>{selectedCameraIndex + 1}</Badge>
                      </div>
                      <Separator />
                      <PTZControls
                        onMove={(direction) => {
                          toast({
                            title: "Camera Movement",
                            description: `Moving camera ${selectedCameraIndex + 1} ${direction}`,
                          });
                        }}
                      />
                      <Separator />
                    </>
                  ) : (
                    <div className="flex items-center justify-center p-4 h-20 bg-muted/20 rounded-md text-sm text-muted-foreground">
                      <Info className="mr-2 h-4 w-4" />
                      Select a camera to control
                    </div>
                  )}
                  <CameraControls
                    onZoom={(level) => {
                      toast({
                        title: "Camera Zoom",
                        description: `Zoom level set to ${level}%`,
                      });
                    }}
                  />
                  <AudioControls
                    levels={audioLevel}
                    onLevelChange={(index, level) => {
                      const newLevels = [...audioLevel];
                      newLevels[index] = level;
                      setAudioLevel(newLevels);
                    }}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Recording</CardTitle>
                </CardHeader>
                <CardContent>
                  <RecordingControls
                    onStart={() => {
                      toast({
                        title: "Recording Started",
                        description: "Studio recording has begun",
                      });
                    }}
                    onStop={() => {
                      toast({
                        title: "Recording Stopped",
                        description: "Studio recording has stopped",
                      });
                    }}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Streaming</CardTitle>
                </CardHeader>
                <CardContent>
                  <StreamingControls
                    onStart={() => {
                      toast({
                        title: "Stream Started",
                        description: "Live stream has begun",
                      });
                    }}
                    onStop={() => {
                      toast({
                        title: "Stream Stopped",
                        description: "Live stream has ended",
                      });
                    }}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Studio Configuration</CardTitle>
              <CardDescription>
                Configure your studio workspace, cameras, and equipment
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
