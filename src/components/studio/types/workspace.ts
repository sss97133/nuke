
export interface WorkspaceDimensions {
  length: number;
  width: number;
  height: number;
}

export interface PTZTrackPosition {
  x: number;
  y: number;
  z: number;
}

export interface PTZTrack {
  position: PTZTrackPosition;
  length: number;
  speed: number;
  coneAngle: number;
}

export interface StudioWorkspaceProps {
  dimensions: WorkspaceDimensions;
  ptzTracks?: PTZTrack[];
}
