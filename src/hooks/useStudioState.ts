
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
      zoom: 1,
      length: 10,    // Default cone length
      coneAngle: 45  // Default cone angle (FOV)
    },
    {
      id: '2',
      name: 'Camera 2',
      position: { x: -10, y: 8, z: 10 },
      rotation: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 5, z: 0 },
      speed: 1,
      zoom: 1,
      length: 10,    // Default cone length
      coneAngle: 45  // Default cone angle (FOV)
    }
  ]);
  
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<number | null>(null);
  const [lightMode, setLightMode] = useState<'basic' | 'product' | 'visualization'>('basic');
  
  // New state for camera view settings
  const [cameraViewMode, setCameraViewMode] = useState<'normal' | 'pov'>('normal');
  const [workspaceLayout, setWorkspaceLayout] = useState<'grid' | 'single'>('single');
  
  // Handle camera selection
  const handleCameraSelect = (index: number) => {
    setSelectedCameraIndex(index);
  };
  
  // Handle camera update (for PTZ controls)
  const handleCameraUpdate = (updatedCamera: PTZTrack) => {
    if (selectedCameraIndex === null) return;
    
    const updatedTracks = [...ptzTracks];
    updatedTracks[selectedCameraIndex] = updatedCamera;
    setPtzTracks(updatedTracks);
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
  
  // Handle field of view changes
  const handleZoomChange = (zoomIn: boolean) => {
    if (selectedCameraIndex === null) return;
    
    const updatedTracks = [...ptzTracks];
    const currentCamera = updatedTracks[selectedCameraIndex];
    
    if (zoomIn) {
      // Zoom in: increase zoom, decrease FOV angle
      currentCamera.zoom = Math.min(3, currentCamera.zoom + 0.1);
      currentCamera.coneAngle = Math.max(15, (currentCamera.coneAngle || 45) - 3);
    } else {
      // Zoom out: decrease zoom, increase FOV angle
      currentCamera.zoom = Math.max(0.5, currentCamera.zoom - 0.1);
      currentCamera.coneAngle = Math.min(120, (currentCamera.coneAngle || 45) + 3);
    }
    
    setPtzTracks(updatedTracks);
  };
  
  // Toggle camera view mode (normal/POV)
  const toggleCameraViewMode = () => {
    setCameraViewMode(prev => prev === 'normal' ? 'pov' : 'normal');
  };
  
  // Toggle workspace layout
  const toggleWorkspaceLayout = () => {
    setWorkspaceLayout(prev => prev === 'single' ? 'grid' : 'single');
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
    cameraViewMode,
    workspaceLayout,
    setIsRecording,
    setIsLive,
    setActiveTab,
    setLightMode,
    handleCameraSelect,
    handleCameraUpdate,
    handleUpdateStudio,
    handleZoomChange,
    toggleCameraViewMode,
    toggleWorkspaceLayout,
    toggleRecording,
    toggleLive
  };
}
