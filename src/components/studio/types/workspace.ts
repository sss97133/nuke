
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface WorkspaceDimensions {
  length: number;
  width: number;
  height: number;
}

export interface PTZTrack {
  id: string;
  name: string;
  position: Vector3;
  rotation?: Vector3;
  target?: Vector3;
  speed: number;
  zoom: number;
  length?: number;  // Adding the missing property
  coneAngle?: number;  // Adding the missing property
}

export interface StudioConfig {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
}
