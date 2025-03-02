
import { useState } from 'react';
import type { PTZTrack, WorkspaceDimensions } from '@/components/studio/types/workspace';

export function useStudioState() {
  const [isRecording, setIsRecording] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [activeTab, setActiveTab] = useState('record');
  
  // Studio configuration state
  const [dimensions, setDimensions] = useState<WorkspaceDimensions>({
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
  
  return {
    isRecording,
    isLive,
    activeTab,
    dimensions,
    ptzTracks,
    selectedCameraIndex,
    lightMode,
    setIsRecording,
    setIsLive,
    setActiveTab,
    setLightMode,
    handleCameraSelect,
    handleUpdateStudio,
    toggleRecording,
    toggleLive
  };
}
