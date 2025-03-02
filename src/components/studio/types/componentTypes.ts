
import { Dispatch, SetStateAction } from 'react';
import type { WorkspaceDimensions, PTZTrack } from '../types/workspace';

export interface StudioWorkspaceProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  onCameraSelect?: (index: number) => void;
  selectedCameraIndex?: number | null;
  activeCamera?: number | null;
}

export interface StudioConfigFormProps {
  initialData: {
    dimensions: WorkspaceDimensions;
    ptzTracks: PTZTrack[];
  };
  onUpdate: (data: {
    length: number;
    width: number;
    height: number;
    ptzTracks: PTZTrack[];
  }) => void;
}

export interface PTZControlsProps {
  selectedCamera?: PTZTrack;
  onUpdate?: (updatedCamera: PTZTrack) => void;
  onMove?: (direction: string) => void;
}

export interface CameraControlsProps {
  onZoom?: (level: number) => void;
}

export interface AudioControlsProps {
  audioLevel: number[];
  setAudioLevel: Dispatch<SetStateAction<number[]>>;
}

export interface RecordingControlsProps {
  onStart?: () => void;
  onStop?: () => void;
}

export interface StreamingControlsProps {
  onStart?: () => void;
  onStop?: () => void;
}
