
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
}
