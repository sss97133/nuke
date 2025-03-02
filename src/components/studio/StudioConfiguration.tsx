
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, Info } from 'lucide-react';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import type { WorkspaceDimensions, PTZTrack } from './types/workspace';
import { toJson } from '@/types/json';

// Import sections
import { StudioPreview } from './sections/PreviewSection';
import { SettingsSection } from './sections/SettingsSection';
import { ControlButtons } from './sections/ControlButtons';

// Import controls
import { PTZControls } from './controls/PTZControls';
import { AudioControls } from './controls/AudioControls';
import { RecordingControls } from './controls/RecordingControls';
import { CameraControls } from './controls/CameraControls';
import { StreamingControls } from './controls/StreamingControls';

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
    id: '1',
    name: 'Default Camera',
    position: { x: 0, y: 8, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 5, z: 0 },
    speed: 1,
    zoom: 1,
    length: 10,
    coneAngle: 45,
  }]);
  
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(50);
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
  }, [dimensions, ptzTracks, isAutoSave, lastSaved]);

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

  const handleSaveConfiguration = () => {
    handleUpdate({
      length: dimensions.length,
      width: dimensions.width,
      height: dimensions.height,
      ptzTracks
    });
  };
  
  // Handle PTZ camera movement
  const handleCameraMove = (direction: string) => {
    if (selectedCameraIndex === null) return;
    
    // Update camera position based on direction
    // This is a simplified version - in a real app, you would adjust the camera's actual position
    toast({
      title: "Camera Movement",
      description: `Camera ${selectedCameraIndex + 1} moved ${direction}`,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading studio configuration...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 border border-destructive rounded-lg text-destructive">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="h-5 w-5" />
          <h3 className="font-semibold">Error loading studio configuration</h3>
        </div>
        <p className="text-sm">{error.message || "Please try refreshing the page."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Studio Configuration</h1>
          <p className="text-muted-foreground">Design and manage your studio setup</p>
        </div>
        
        <div className="flex space-x-2">
          <Button variant="outline" size="sm" onClick={() => setIsAutoSave(!isAutoSave)}>
            Auto-Save: {isAutoSave ? 'On' : 'Off'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleSavePreset}>
            Save Preset
          </Button>
          <Button size="sm" onClick={handleSaveConfiguration}>
            Save
          </Button>
        </div>
      </div>
      
      {lastSaved && (
        <div className="flex items-center text-sm text-muted-foreground">
          <Info className="h-4 w-4 mr-1" />
          Last saved: {lastSaved.toLocaleTimeString()}
        </div>
      )}
      
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 w-80">
          <TabsTrigger value="simulator">Simulator</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        
        <TabsContent value="simulator" className="mt-6">
          <StudioPreview 
            dimensions={dimensions}
            ptzTracks={ptzTracks}
            selectedCameraIndex={selectedCameraIndex}
            onCameraSelect={handleCameraSelect}
            lightMode="basic"
            setLightMode={() => {}}
          />
        </TabsContent>
        
        <TabsContent value="controls" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <PTZControls 
              selectedCamera={selectedCameraIndex !== null ? ptzTracks[selectedCameraIndex] : undefined}
              onUpdate={(updatedCamera) => {
                if (selectedCameraIndex === null) return;
                const newTracks = [...ptzTracks];
                newTracks[selectedCameraIndex] = updatedCamera;
                setPTZTracks(newTracks);
              }}
            />
            <AudioControls 
              audioLevel={audioLevel}
              setAudioLevel={(level) => setAudioLevel(level)}
            />
            <RecordingControls 
              onStart={() => {}}
              onStop={() => {}}
            />
            <CameraControls />
            <StreamingControls 
              onStart={() => {}}
              onStop={() => {}}
            />
          </div>
        </TabsContent>
        
        <TabsContent value="settings" className="mt-6">
          <SettingsSection 
            dimensions={dimensions}
            ptzTracks={ptzTracks}
            onUpdate={(data) => {
              setDimensions({
                length: Number(data.length),
                width: Number(data.width),
                height: Number(data.height),
              });
              setPTZTracks(data.ptzTracks);
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};
