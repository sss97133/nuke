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

export interface WallConfiguration {
  position: PTZTrackPosition;
  dimensions: {
    width: number;
    height: number;
  };
  material?: string;
  color?: string;
}

export interface CeilingConfiguration {
  height: number;
  material?: string;
  color?: string;
  fixtures?: Array<{
    position: PTZTrackPosition;
    type: string;
    dimensions?: {
      width: number;
      height: number;
    };
  }>;
}

export interface PTZPlanes {
  walls: WallConfiguration[];
  ceiling: CeilingConfiguration;
}

export interface RoboticArm {
  position: PTZTrackPosition;
  reach: number;
  joints: number;
  payload: number;
  speed: number;
  model?: string;
}

export interface PTZConfigurations {
  tracks: PTZTrack[];
  planes: PTZPlanes;
  roboticArms: RoboticArm[];
}

export interface CameraConfig {
  resolution: string;
  frameRate: number;
  iso?: number;
  aperture?: number;
  focusMode?: 'auto' | 'manual';
  whiteBalance?: 'auto' | 'manual' | number;
  [key: string]: string | number | undefined;
}

export interface AudioConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format?: string;
  noiseReduction?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface LightingConfig {
  brightness: number;
  temperature: number;
  mode?: 'auto' | 'manual';
  presets?: Record<string, {
    brightness: number;
    temperature: number;
  }>;
  [key: string]: string | number | boolean | Record<string, unknown> | undefined;
}

export interface FixedCameraPosition {
  position: PTZTrackPosition;
  orientation: {
    pitch: number;
    yaw: number;
    roll: number;
  };
  config?: CameraConfig;
}

export interface StudioConfiguration {
  id?: string;
  name: string;
  workspace_dimensions?: WorkspaceDimensions;
  ptz_configurations?: PTZConfigurations;
  camera_config?: CameraConfig;
  audio_config?: AudioConfig;
  lighting_config?: LightingConfig;
  fixed_cameras?: {
    positions: FixedCameraPosition[];
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

