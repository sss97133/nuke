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

export interface StudioConfigurationType {
  id: string;
  user_id: string;
  name: string;
  workspace_dimensions: {
    length: number;
    width: number;
    height: number;
  };
  ptz_configurations: {
    tracks: PTZTrack[];
  };
  camera_config: Record<string, any>;
  audio_config: Record<string, any>;
  lighting_config: Record<string, any>;
  created_at: string;
  updated_at: string;
}