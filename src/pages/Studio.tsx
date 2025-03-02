
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStudioState } from '@/hooks/useStudioState';

// Import our refactored studio tab components
import { RecordTab } from '@/components/studio/tabs/RecordTab';
import { StreamTab } from '@/components/studio/tabs/StreamTab';
import { EditTab } from '@/components/studio/tabs/EditTab';
import { SettingsTab } from '@/components/studio/tabs/SettingsTab';

const Studio = () => {
  const {
    isRecording,
    isLive,
    activeTab,
    dimensions,
    ptzTracks,
    selectedCameraIndex,
    lightMode,
    setActiveTab,
    setLightMode,
    handleCameraSelect,
    handleUpdateStudio,
    toggleRecording,
    toggleLive
  } = useStudioState();
  
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
            <RecordTab 
              dimensions={dimensions}
              ptzTracks={ptzTracks}
              selectedCameraIndex={selectedCameraIndex}
              onCameraSelect={handleCameraSelect}
              lightMode={lightMode}
              setLightMode={setLightMode}
              isRecording={isRecording}
              toggleRecording={toggleRecording}
            />
          </TabsContent>
          
          <TabsContent value="stream">
            <StreamTab 
              dimensions={dimensions}
              ptzTracks={ptzTracks}
              selectedCameraIndex={selectedCameraIndex}
              onCameraSelect={handleCameraSelect}
              lightMode={lightMode}
              setLightMode={setLightMode}
              isLive={isLive}
              toggleLive={toggleLive}
            />
          </TabsContent>
          
          <TabsContent value="edit">
            <EditTab />
          </TabsContent>
          
          <TabsContent value="settings">
            <SettingsTab 
              dimensions={dimensions}
              ptzTracks={ptzTracks}
              selectedCameraIndex={selectedCameraIndex}
              onUpdate={handleUpdateStudio}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default Studio;
