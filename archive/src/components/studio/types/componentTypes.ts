
import type { PTZTrack } from './workspace';

export interface RecordingControlsProps {
  onStart?: () => void;
  onStop?: () => void;
}

export interface StreamingControlsProps {
  onStart?: () => void;
  onStop?: () => void;
}

export interface AudioControlsProps {
  audioLevel: number;
  setAudioLevel: (level: number) => void;
}

export interface CameraControlsProps {
  // Add camera control specific props here
}

export interface PTZControlsProps {
  selectedCamera?: PTZTrack;
  onUpdate: (updatedCamera: PTZTrack) => void;
  onMove?: (direction: string) => void; // Add this optional prop
}

export interface StudioConfigFormProps {
  initialData: {
    dimensions: {
      length: number;
      width: number;
      height: number;
    };
    ptzTracks: PTZTrack[];
  };
  onUpdate: (data: any) => void;
}

export interface StudioWorkspaceProps {
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  ptzTracks: PTZTrack[];
  activeCamera?: number | null;
  onCameraSelect?: (index: number) => void;
  selectedCameraIndex?: number | null; // Add this property
}

export interface ControlButtonsProps {
  isRecording: boolean;
  toggleRecording: () => void;
  isAutoSave?: boolean; // Add this optional prop
  setIsAutoSave?: React.Dispatch<React.SetStateAction<boolean>>; // Add this optional prop
  handleSavePreset?: () => void; // Add this optional prop
  handleSaveConfiguration?: () => void; // Add this optional prop
}
