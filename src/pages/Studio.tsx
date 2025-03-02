
import React, { useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
  Video, Mic, Camera, Settings, PauseCircle, PlayCircle, 
  Film, Download, Share, Monitor, ScreenShare, Users, Sliders
} from 'lucide-react';

// Import our studio components
import { StudioPreview } from '@/components/studio/sections/PreviewSection';
import { RecordingControls } from '@/components/studio/controls/RecordingControls';
import { StreamingControls } from '@/components/studio/controls/StreamingControls';
import { CameraControls } from '@/components/studio/controls/CameraControls';
import { AudioControls } from '@/components/studio/controls/AudioControls';
import { SettingsSection } from '@/components/studio/sections/SettingsSection';
import { ControlButtons } from '@/components/studio/sections/ControlButtons';
import { PTZControls } from '@/components/studio/controls/PTZControls';
import type { PTZTrack } from '@/components/studio/types/workspace';

const Studio = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [activeTab, setActiveTab] = useState('record');
  
  // Studio configuration state
  const [dimensions, setDimensions] = useState({
    length: 30,
    width: 30,
    height: 15
  });
  
  const [ptzTracks, setPtzTracks] = useState<PTZTrack[]>([
    {
      id: '1',
      name: 'Camera 1',
      position: { x: 10, y: 8, z: 10 },
      rotation: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 5, z: 0 },
      speed: 1,
      zoom: 1
    },
    {
      id: '2',
      name: 'Camera 2',
      position: { x: -10, y: 8, z: 10 },
      rotation: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 5, z: 0 },
      speed: 1,
      zoom: 1
    }
  ]);
  
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<number | null>(null);
  const [lightMode, setLightMode] = useState<'basic' | 'product'>('basic');
  
  // Handle camera selection
  const handleCameraSelect = (index: number) => {
    setSelectedCameraIndex(index);
  };
  
  // Handle studio configuration updates
  const handleUpdateStudio = (data: {
    length: number;
    width: number;
    height: number;
    ptzTracks: PTZTrack[];
  }) => {
    setDimensions({
      length: data.length,
      width: data.width,
      height: data.height
    });
    setPtzTracks(data.ptzTracks);
  };
  
  const toggleRecording = () => setIsRecording(!isRecording);
  const toggleLive = () => setIsLive(!isLive);
  
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Studio</h1>
          <p className="text-muted-foreground">
            Create, record, and stream professional automotive content
          </p>
        </div>
        
        <Tabs defaultValue="record" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="record">Record</TabsTrigger>
            <TabsTrigger value="stream">Stream</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          
          <TabsContent value="record">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="md:col-span-2">
                <Card className="border-2 border overflow-hidden p-0">
                  <StudioPreview 
                    dimensions={dimensions}
                    ptzTracks={ptzTracks}
                    selectedCameraIndex={selectedCameraIndex}
                    onCameraSelect={handleCameraSelect}
                    lightMode={lightMode}
                    setLightMode={setLightMode}
                  />
                </Card>
                
                <ControlButtons 
                  isRecording={isRecording}
                  toggleRecording={toggleRecording}
                />
              </div>
              
              <div className="space-y-6">
                <CameraControls />
                
                <AudioControls 
                  audioLevel={75}
                  setAudioLevel={() => {}}
                />
                
                <RecordingControls 
                  onStart={() => setIsRecording(true)}
                  onStop={() => setIsRecording(false)}
                />
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="stream">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="md:col-span-2">
                <Card className="border-2 border overflow-hidden p-0">
                  <StudioPreview 
                    dimensions={dimensions}
                    ptzTracks={ptzTracks}
                    selectedCameraIndex={selectedCameraIndex}
                    onCameraSelect={handleCameraSelect}
                    lightMode={lightMode}
                    setLightMode={setLightMode}
                  />
                </Card>
                
                <div className="flex justify-center space-x-4 mt-4">
                  <Button
                    variant={isLive ? "destructive" : "default"}
                    size="lg"
                    className="gap-2"
                    onClick={toggleLive}
                  >
                    {isLive ? (
                      <>
                        <PauseCircle className="h-5 w-5" />
                        End Stream
                      </>
                    ) : (
                      <>
                        <PlayCircle className="h-5 w-5" />
                        Go Live
                      </>
                    )}
                  </Button>
                  
                  <Button variant="outline" size="lg" className="gap-2">
                    <Share className="h-5 w-5" />
                    Share Stream
                  </Button>
                </div>
              </div>
              
              <div className="space-y-6">
                <StreamingControls 
                  onStart={() => setIsLive(true)}
                  onStop={() => setIsLive(false)}
                />
                
                <Card>
                  <CardHeader>
                    <CardTitle>Viewer Stats</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-4">
                      <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-3xl font-bold">0</p>
                      <p className="text-sm text-muted-foreground">Live Viewers</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="edit">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center p-10">
                  <Sliders className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-medium mb-2">Video Editor</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Edit your recorded videos, add overlays, trim content, and prepare for publishing
                  </p>
                  <div className="flex justify-center gap-4">
                    <Button>Open Editor</Button>
                    <Button variant="outline">Recent Projects</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="settings">
            <SettingsSection 
              dimensions={dimensions}
              ptzTracks={ptzTracks}
              onUpdate={handleUpdateStudio}
            />
            
            {selectedCameraIndex !== null && (
              <div className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Camera Settings</CardTitle>
                    <CardDescription>Configure the selected camera</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <PTZControls
                      selectedCamera={ptzTracks[selectedCameraIndex]}
                      onUpdate={(updatedCamera) => {
                        const newTracks = [...ptzTracks];
                        newTracks[selectedCameraIndex] = updatedCamera;
                        setPtzTracks(newTracks);
                      }}
                    />
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default Studio;
