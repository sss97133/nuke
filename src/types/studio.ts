
export interface WorkspaceDimensions {
  width: number;
  height: number;
  length: number;
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

export interface PTZPlanes {
  walls: any[];
  ceiling: Record<string, any>;
}

export interface PTZConfigurations {
  tracks: PTZTrack[];
  planes: PTZPlanes;
  roboticArms: any[];
}

export interface StudioConfiguration {
  id?: string;
  name: string;
  workspace_dimensions?: WorkspaceDimensions;
  ptz_configurations?: PTZConfigurations;
  camera_config?: Record<string, any>;
  audio_config?: Record<string, any>;
  lighting_config?: Record<string, any>;
  fixed_cameras?: {
    positions: any[];
  };
}

export interface PTZConfigurationProps {
  ptzTracks: PTZTrack[];
  onUpdate: (tracks: PTZTrack[]) => void;
}

export interface StudioDimensionsProps {
  dimensions: WorkspaceDimensions;
  onUpdate: (dimensions: WorkspaceDimensions) => void;
}

export const isWorkspaceDimensions = (value: unknown): value is WorkspaceDimensions => {
  if (typeof value !== 'object' || value === null) return false;
  const dims = value as Record<string, unknown>;
  return (
    typeof dims.width === 'number' &&
    typeof dims.height === 'number' &&
    typeof dims.length === 'number'
  );
};

export const isPTZConfigurations = (value: unknown): value is PTZConfigurations => {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as Record<string, unknown>;
  return (
    Array.isArray(config.tracks) &&
    typeof config.planes === 'object' &&
    config.planes !== null &&
    Array.isArray(config.roboticArms)
  );
};

