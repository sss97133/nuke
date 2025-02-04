export interface PTZTrack {
  position: {
    x: number;
    y: number;
    z: number;
  };
  length: number;
  speed: number;
  coneAngle: number;
}

export interface WorkspaceDimensions {
  width: number;
  height: number;
  length: number;
}

export interface PTZConfigurations {
  tracks: PTZTrack[];
  planes?: {
    walls: any[];
    ceiling: Record<string, any>;
  };
  roboticArms?: any[];
}

export interface StudioConfigurationType {
  id: string;
  user_id: string | null;
  name: string;
  workspace_dimensions: WorkspaceDimensions;
  ptz_configurations: PTZConfigurations;
  camera_config: Record<string, any> | null;
  audio_config: Record<string, any> | null;
  lighting_config: Record<string, any> | null;
  fixed_cameras: { positions: any[] } | null;
  created_at: string;
  updated_at: string;
}