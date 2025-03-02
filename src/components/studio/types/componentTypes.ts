
import { Dispatch, SetStateAction } from 'react';
import type { WorkspaceDimensions, PTZTrack } from '@/types/studio';

export interface StudioWorkspaceProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  onSelectCamera?: (index: number) => void;
  selectedCameraIndex?: number | null;
}

export interface StudioConfigFormProps {
  initialDimensions: WorkspaceDimensions;
  initialPTZTracks: PTZTrack[];
  onUpdateDimensions: Dispatch<SetStateAction<WorkspaceDimensions>>;
  onUpdatePTZTracks: Dispatch<SetStateAction<PTZTrack[]>>;
}

export interface PTZControlsProps {
  onMove: (direction: string) => void;
}

export interface CameraControlsProps {
  onZoom: (level: number) => void;
}

export interface AudioControlsProps {
  levels: number[];
  onLevelChange: (index: number, level: number) => void;
}

export interface RecordingControlsProps {
  onStart: () => void;
  onStop: () => void;
}

export interface StreamingControlsProps {
  onStart: () => void;
  onStop: () => void;
}
