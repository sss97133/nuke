import { Json } from '@/integrations/supabase/types';

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

export interface StudioConfigurationType {
  id: string;
  user_id: string;
  name: string;
  workspace_dimensions: WorkspaceDimensions;
  ptz_configurations: PTZConfigurations;
  camera_config: Record<string, any>;
  audio_config: Record<string, any>;
  lighting_config: Record<string, any>;
  fixed_cameras: { positions: any[] };
  created_at: string;
  updated_at: string;
}

export interface StudioDimensionsProps {
  dimensions: WorkspaceDimensions;
  onUpdate: (dimensions: WorkspaceDimensions) => void;
}

export interface PTZConfigurationProps {
  ptzTracks: PTZTrack[];
  onUpdate: (tracks: PTZTrack[]) => void;
}

export const isWorkspaceDimensions = (json: Json | null): json is Record<string, number> => {
  if (typeof json !== 'object' || !json) return false;
  const dims = json as Record<string, unknown>;
  return (
    typeof dims.width === 'number' &&
    typeof dims.height === 'number' &&
    typeof dims.length === 'number'
  );
};

export const isPTZConfigurations = (json: Json | null): json is Record<string, any> => {
  if (typeof json !== 'object' || !json) return false;
  const config = json as Record<string, unknown>;
  return Array.isArray(config.tracks);
};

export const toJson = (obj: unknown): Json => {
  return JSON.parse(JSON.stringify(obj));
};